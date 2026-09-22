import test from 'node:test';
import assert from 'node:assert/strict';
import { orderSummary, orderDetail, deliveryTimestamp } from '../src/order-data.js';
import { responseIdentity } from '../src/identity.js';
import { toolResult, toolError, decorateToolMessage } from '../src/responses.js';
import { OrderHistory } from '../src/order-history.js';
import { ServiceError } from '../src/core.js';

const raw = () => ({
  OrderId: 101,
  OrderNo: 'ORDER-101',
  CreationDatetime: '2026-01-01T01:00:00Z',
  DeliveredAt: '2026-01-03T04:10:12.795069772Z',
  ProductDetailsForOrderList: [],
  PricingDetails: [],
});
test('history delivery wins over detail creation-time bug and preserves the disagreement', () => {
  const history = orderSummary(raw());
  const detail = orderDetail({ ...raw(), DeliveredAt: '2026-01-01T01:00:00Z' }, history);
  assert.equal(detail.deliveredAt, history.deliveredAt);
  assert.equal(detail.deliveredAt, '2026-01-03T04:10:12.795Z');
  assert.equal(detail.deliveryTimestamp.historyReported, raw().DeliveredAt);
  assert.equal(detail.deliveryTimestamp.detailReported, '2026-01-01T01:00:00Z');
  assert.equal(detail.deliveryTimestamp.discrepancy, true);
  assert.ok(detail.deliveryTimestamp.detailDifferenceMs < -86400_000);
});
test('fractional precision, UTC offsets and absent history cannot fabricate delivery times', () => {
  const history = orderSummary(raw());
  const equal = orderDetail({ ...raw(), DeliveredAt: '2026-01-03T09:40:12.795+05:30' }, history);
  assert.equal(equal.deliveryTimestamp.discrepancy, false);
  const rounded = orderDetail({ ...raw(), DeliveredAt: '2026-01-03T04:10:13Z' }, history);
  assert.equal(rounded.deliveryTimestamp.detailDifferenceMs, 205);
  const absent = orderDetail(raw(), orderSummary({ ...raw(), DeliveredAt: null }));
  assert.equal(absent.deliveredAt, null);
  assert.equal(absent.deliveryTimestamp.discrepancy, null);
  assert.equal(deliveryTimestamp('2026-01-03'), null);
  assert.equal(deliveryTimestamp('2026-02-30T04:10:12Z'), null);
  assert.equal(deliveryTimestamp('2026-01-03T04:10:12'), null);
  assert.throws(
    () => orderDetail(raw(), { orderId: '101', orderNumber: 'ORDER-101' }),
    /Rediscover/,
  );
  assert.throws(() => orderDetail(raw(), { ...history, orderId: '102' }), /Rediscover/);
});
test('discovered history persists canonical delivery and rejects pre-upgrade cursor caches', async () => {
  const store = {
    values: {},
    async read(k, f) {
      return structuredClone(this.values[k] ?? f);
    },
    async write(k, v) {
      this.values[k] = structuredClone(v);
    },
  };
  const now = Date.parse('2026-01-04T00:00:00Z'),
    pager = new OrderHistory(store, 'secret', () => now);
  const context = {
    binding: 'example-outlet',
    firstPage: [raw(), { ...raw(), OrderId: 102, OrderNo: 'ORDER-102' }],
    fetchPage: async () => [],
  };
  const page = await pager.list({ pageSize: 1 }, context);
  assert.equal(store.values['order-index'].orders['101'].deliveredAt, page.orders[0].deliveredAt);
  const restored = new OrderHistory(store, 'secret', () => now);
  assert.equal(
    (await restored.list({ cursor: page.pagination.nextCursor }, context)).orders[0].orderId,
    '102',
  );
  delete store.values['order-pages'][page.snapshotId].schemaVersion;
  await assert.rejects(
    restored.list({ cursor: page.pagination.nextCursor }, context),
    /Start a fresh/,
  );
});
const config = {
  key: 'synthetic-private-key',
  mobile: '9000000000',
  binding: {
    text: 'Example Kitchen: 1 Example Road',
    parts: ['Example Kitchen:', '1 Example Road'],
  },
  outletId: '42',
  verified: true,
};
test('identity is stable, account-scoped and explicit about configured versus verified values', () => {
  const identity = responseIdentity(config);
  assert.deepEqual(responseIdentity({ ...config }), identity);
  assert.equal(identity.account.loginMobileMasked, '******0000');
  assert.equal(identity.account.source, 'configured_login');
  assert.equal(identity.outlet.id, '42');
  assert.equal(identity.outlet.name, 'Example Kitchen');
  assert.equal(identity.verification, 'outlet_verified');
  assert.ok(!JSON.stringify(identity).includes(config.mobile));
  assert.notEqual(
    responseIdentity({ ...config, mobile: '9000000001' }).account.reference,
    identity.account.reference,
  );
  assert.notEqual(
    responseIdentity({ ...config, mobile: '9000000001' }).outlet.reference,
    identity.outlet.reference,
  );
  const expired = responseIdentity({ ...config, verified: false });
  assert.equal(expired.verification, 'unverified');
  assert.deepEqual(expired.account, identity.account);
});
test('all JSON, PDF, application-error and SDK-error results carry identity without duplicating PDF blobs', () => {
  const identity = responseIdentity(config);
  for (const payload of [
    { state: 'READY' },
    { products: [] },
    { items: [] },
    { changed: false, cart: { items: [] } },
    { orders: [] },
    { orderId: '101' },
    { id: 'review' },
  ]) {
    const result = toolResult(payload, identity);
    assert.deepEqual(result.structuredContent.identity, identity);
    assert.deepEqual(JSON.parse(result.content[0].text).identity, identity);
  }
  for (const documentKind of ['invoice', 'credit-notes']) {
    const pdf = toolResult(
      { mimeType: 'application/pdf', blob: 'JVBERi0=', orderId: '101', documentKind },
      identity,
    );
    assert.deepEqual(pdf.structuredContent.identity, identity);
    assert.equal(pdf.structuredContent.blob, undefined);
    assert.equal(pdf.content[0].resource.blob, 'JVBERi0=');
    assert.deepEqual(JSON.parse(pdf.content[1].text).identity, identity);
  }
  const error = toolError(
    new ServiceError('AUTH_REQUIRED'),
    responseIdentity({ ...config, verified: false }),
    'https://example.com/owner',
  );
  assert.equal(error.isError, true);
  assert.equal(error.structuredContent.identity.verification, 'unverified');
  const sdk = decorateToolMessage(
    { id: 1, result: { isError: true, content: [{ type: 'text', text: 'Invalid input' }] } },
    identity,
  );
  assert.equal(sdk.result.isError, true);
  assert.deepEqual(sdk.result.structuredContent.identity, identity);
  const rpc = decorateToolMessage(
    { id: 2, error: { code: -32602, message: 'Invalid input' } },
    identity,
  );
  assert.deepEqual(rpc.error.data.identity, identity);
  assert.deepEqual(decorateToolMessage({ id: 3, result: error }, identity).result, error);
});
