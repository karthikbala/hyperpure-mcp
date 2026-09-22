import { createHmac } from 'node:crypto';
import { ServiceError, token, digest, sameSecret } from './core.js';
import { orderSummary } from './order-data.js';

const TTL = 60 * 60_000,
  SOURCE_PAGE_SIZE = 20,
  MAX_PAGES_PER_CALL = 5;
function day(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new ServiceError('INVALID_DATE', 'Use a real calendar date in YYYY-MM-DD format.');
  return Date.parse(`${value}T00:00:00+05:30`);
}
export function filters(args = {}) {
  const from = args.dateFrom === undefined ? null : day(args.dateFrom),
    to = args.dateTo === undefined ? null : day(args.dateTo) + 86400_000;
  if (from !== null && to !== null && from >= to) throw new ServiceError('INVALID_DATE_RANGE');
  const pageSize = args.pageSize ?? 20;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
    throw new ServiceError('INVALID_PAGE_SIZE');
  return { dateFrom: args.dateFrom ?? null, dateTo: args.dateTo ?? null, from, to, pageSize };
}

export class OrderHistory {
  constructor(store, secret, now = Date.now) {
    this.store = store;
    this.secret = secret;
    this.now = now;
  }
  encode(id, step) {
    const data = Buffer.from(JSON.stringify({ id, step })).toString('base64url');
    return data + '.' + createHmac('sha256', this.secret).update(data).digest('base64url');
  }
  decode(cursor) {
    if (typeof cursor !== 'string' || cursor.length > 400) throw new ServiceError('INVALID_CURSOR');
    const [data, signature, ...rest] = cursor.split('.');
    if (
      rest.length ||
      !sameSecret(signature, createHmac('sha256', this.secret).update(data).digest('base64url'))
    )
      throw new ServiceError('INVALID_CURSOR');
    let value;
    try {
      value = JSON.parse(Buffer.from(data, 'base64url').toString());
    } catch {
      throw new ServiceError('INVALID_CURSOR');
    }
    if (!/^[\w-]{43}$/.test(value.id) || !Number.isInteger(value.step) || value.step < 0)
      throw new ServiceError('INVALID_CURSOR');
    return value;
  }
  async remember(rows, binding) {
    const index = await this.store.read('order-index', { binding, orders: {} });
    if (index.binding !== binding) {
      index.binding = binding;
      index.orders = {};
    }
    for (const r of rows) {
      const o = orderSummary(r);
      index.orders[o.orderId] = o;
    }
    await this.store.write('order-index', index);
  }
  async list(args, { binding, firstPage, fetchPage }) {
    const now = this.now();
    const states = Object.fromEntries(
      Object.entries(await this.store.read('order-pages', {})).filter(
        ([, s]) => s.expiresAt > now && s.schemaVersion === '2.1',
      ),
    );
    let state,
      step = 0,
      id;
    if (args.cursor) {
      ({ id, step } = this.decode(args.cursor));
      state = states[id];
      if (!state || state.binding !== binding)
        throw new ServiceError(
          'CURSOR_EXPIRED',
          'Start a fresh list_orders request without a cursor.',
        );
      for (const key of ['dateFrom', 'dateTo', 'pageSize'])
        if (args[key] !== undefined && args[key] !== state.filter[key])
          throw new ServiceError('CURSOR_FILTER_MISMATCH');
      if (state.responses[step]) return state.responses[step];
      if (step !== state.nextStep) throw new ServiceError('INVALID_CURSOR');
    } else {
      if (Object.keys(states).length >= 20)
        throw new ServiceError(
          'TOO_MANY_HISTORY_SNAPSHOTS',
          'Reuse the returned cursor or wait for an older snapshot to expire.',
        );
      id = token();
      state = {
        schemaVersion: '2.1',
        binding,
        filter: filters(args),
        anchor: null,
        asOf: new Date(now).toISOString(),
        expiresAt: now + TTL,
        nextSourcePage: 1,
        orders: [],
        seen: [],
        lastCreatedAt: null,
        complete: false,
        offset: 0,
        nextStep: 0,
        responses: {},
      };
      states[id] = state;
    }
    const anchor = digest(JSON.stringify(firstPage.map((r) => [r.OrderId, r.CreationDatetime])));
    if (state.anchor && state.anchor !== anchor)
      throw new ServiceError(
        'HISTORY_CHANGED_RESTART',
        'New or removed orders changed the history. Start a fresh date-filtered scan.',
      );
    state.anchor = anchor;
    let scanned = 0;
    const seen = new Set(state.seen);
    while (
      !state.complete &&
      state.orders.length < state.offset + state.filter.pageSize + 1 &&
      scanned < MAX_PAGES_PER_CALL
    ) {
      if (state.nextSourcePage > 100)
        throw new ServiceError(
          'HISTORY_SCAN_LIMIT',
          'History scan exceeded 2,000 orders; no complete result is claimed.',
        );
      const rows =
        state.nextSourcePage === 1
          ? firstPage
          : await fetchPage(state.nextSourcePage, SOURCE_PAGE_SIZE);
      if (!Array.isArray(rows)) throw new ServiceError('ORDER_SCHEMA_CHANGED');
      await this.remember(rows, binding);
      let added = 0;
      for (const raw of rows) {
        const order = orderSummary(raw),
          created = Date.parse(order.createdAt);
        if (seen.has(order.orderId)) continue;
        if (state.lastCreatedAt !== null && created > state.lastCreatedAt)
          throw new ServiceError(
            'HISTORY_ORDER_CHANGED',
            'History is not in descending creation order. Restart the scan.',
          );
        state.lastCreatedAt = created;
        seen.add(order.orderId);
        added++;
        if (
          created <= Date.parse(state.asOf) &&
          (state.filter.from === null || created >= state.filter.from) &&
          (state.filter.to === null || created < state.filter.to)
        )
          state.orders.push(order);
      }
      if (rows.length && !added) throw new ServiceError('HISTORY_PAGINATION_STALLED');
      state.nextSourcePage++;
      scanned++;
      if (
        rows.length < SOURCE_PAGE_SIZE ||
        (state.filter.from !== null &&
          state.lastCreatedAt !== null &&
          state.lastCreatedAt < state.filter.from)
      )
        state.complete = true;
    }
    state.seen = [...seen];
    const orders = state.orders.slice(state.offset, state.offset + state.filter.pageSize);
    state.offset += orders.length;
    state.nextStep++;
    const hasMore = state.offset < state.orders.length || !state.complete;
    const response = {
      schemaVersion: '2.1',
      orders,
      orderIds: orders.map((o) => o.orderId),
      filter: {
        dateFrom: state.filter.dateFrom,
        dateTo: state.filter.dateTo,
        dateBasis: 'order_creation',
        timezone: 'Asia/Kolkata',
        inclusive: true,
      },
      pagination: {
        page: step + 1,
        pageSize: state.filter.pageSize,
        nextCursor: hasMore ? this.encode(id, step + 1) : null,
        hasMore,
        scanComplete: state.complete,
        totalMatched: state.complete ? state.orders.length : null,
        sourcePagesScanned: state.nextSourcePage - 1,
      },
      snapshotId: id,
      asOf: state.asOf,
      expiresAt: new Date(state.expiresAt).toISOString(),
      observedAt: new Date(now).toISOString(),
      scope:
        'Follow nextCursor until null, including empty pages. Filters use order creation date, not refund or modification date. Fetched pages are cached for one hour; each new scan refreshes the source.',
    };
    state.responses[step] = response;
    await this.store.write('order-pages', states);
    return response;
  }
}
