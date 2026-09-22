import test from 'node:test';
import assert from 'node:assert/strict';
import { orderDetail as normalizeDetail, orderSummary } from '../src/order-data.js';
import { OrderHistory, filters } from '../src/order-history.js';

const orderDetail = (raw) => normalizeDetail(raw, orderSummary(raw));
const row = (label, value) => ({ Title: `<span>${label}</span>`, Value: `<span>${value}</span>` });
const base = () => ({
  OrderId: 101,
  OrderNo: 'ORDER-101',
  CreationDatetime: '2026-09-17T17:36:25Z',
  Status: 'Delivered',
  PaymentStatus: 'Paid',
  ProductCount: 2,
  TotalPrice: 1367.1,
  SubTotal: 1338.1,
  Discount: 36.1,
  CartLevelDiscount: 0,
  TotalTax: 65.1,
  PricingDetails: [
    row('Item total', '₹1,338.10'),
    row('Product discount', '- ₹36.10'),
    row('GST + Cess', '+ ₹65.10'),
    row('Delivery charge', 'FREE'),
  ],
  ProductDetailsForOrderList: [
    {
      ProductId: 1,
      ProductName: 'Cheese A',
      MeasurementUnit: 'Pack',
      QtyOrdered: 1,
      QtyDispatched: 1,
      QuantityDelivered: 1,
      Price: 500,
      OriginalPricePerUnit: 500,
      PricePerUnitInclTax: 525,
      TotalOrderPrice: 500,
      QuantityOrderedPrice: 525,
      QuantityDeliveredPrice: 525,
      GSTRate: 5,
      CessRate: 0,
      TaxAmount: 25,
      DiscountedQuantity: 0,
      DiscountMessage: '',
    },
    {
      ProductId: 2,
      ProductName: 'Cheese B',
      MeasurementUnit: 'Pack',
      QtyOrdered: 2,
      QtyDispatched: 2,
      QuantityDelivered: 2,
      Price: 401,
      OriginalPricePerUnit: 419.05,
      PricePerUnitInclTax: 421.05,
      TotalOrderPrice: 802,
      QuantityOrderedPrice: 842.1,
      QuantityDeliveredPrice: 842.1,
      GSTRate: 5,
      CessRate: 0,
      TaxAmount: 40.1,
      DiscountedQuantity: 0,
      DiscountMessage: '₹ 36.10 DISCOUNT APPLIED',
    },
  ],
  CreditNotes: [],
  Refunds: [],
  IssueHistory: { TotalIssueCount: 0, IssueDetails: null },
  InvoiceSignedPath: 'https://example.invalid/private-invoice',
});

test('line quantities, discounted prices and GST reconcile without losing zeros or inventing tax splits', () => {
  const d = orderDetail(base());
  assert.equal(d.items[1].quantity.ordered, 2);
  assert.equal(d.items[1].pricing.discount.amount, 36.1);
  assert.equal(d.items[1].pricing.orderedAmountInclTax, 842.1);
  assert.equal(d.items[1].pricing.tax.amount, 40.1);
  assert.equal(d.items[1].pricing.tax.cessRatePercent, 0);
  assert.equal(d.items[1].pricing.tax.cessAmount, null);
  assert.equal(d.reconciliation.status, 'matched');
  assert.equal(d.reconciliation.pricingRowsTotal, 1367.1);
  assert.ok(!JSON.stringify(d).includes('private-invoice'));
  const incomplete = base();
  delete incomplete.ProductDetailsForOrderList;
  assert.throws(() => orderDetail(incomplete), /Structured order items/);
});

test('a reported shortage is retained even when delivered quantity equals ordered quantity', () => {
  const raw = base();
  raw.IssueHistory = {
    TotalIssueCount: 1,
    IssueDetails: [
      {
        TicketId: '91',
        CardTitle: { TitleTag: { Text: 'REFUND COMPLETED' } },
        Products: [
          {
            Name: 'Cheese A',
            IssueType: { Value: 'Less quantity received' },
            IssueQty: { Value: '1 Kilogram' },
            RefundQty: { Value: '0.50 Kilogram' },
            RefundPrice: { Value: '₹131.60' },
          },
        ],
      },
    ],
  };
  raw.CreditNotes = [
    {
      CreditNoteNumber: 'CN-91',
      CreatedAt: '2026-09-19T01:00:00Z',
      Amount: 131.6,
      TicketId: 91,
      CreditNoteProducts: null,
    },
  ];
  raw.Refunds = [
    {
      RefundDate: '2026-09-19T01:00:01Z',
      RefundType: 'online',
      RefundStatus: 'success',
      RefundAmount: 131.6,
    },
  ];
  const d = orderDetail(raw);
  assert.equal(d.fulfillmentGaps.length, 0);
  assert.equal(d.shortages.length, 1);
  assert.equal(d.shortages[0].reportedIssueQuantity.value, 1);
  assert.equal(d.shortages[0].refundedQuantity.value, 0.5);
  assert.equal(d.shortages[0].refundedQuantity.unit, 'Kilogram');
  assert.equal(d.totals.creditNoteTotal, 131.6);
  assert.equal(d.refunds[0].amount, 131.6);
  assert.equal(d.creditNotes[0].items, null);
  assert.equal(d.creditNotes[0].ticketId, '91');
});

test('returned orders preserve historical delivery, tier discounts and fee tax without claiming pickup quantities', () => {
  const raw = base();
  Object.assign(raw, {
    Status: 'Returned',
    ProductCount: 1,
    TotalPrice: 917.08,
    SubTotal: 768,
    Discount: 49.92,
    TotalTax: 0,
    ReturnStatusV2: { Title: 'Order returned' },
    ReturnStatus: { Title: { Text: 'Order returned. Refund has been completed' } },
    PricingDetails: [
      row('Item total', '₹768'),
      row('Product discount', '- ₹49.92'),
      row('GST + Cess', '+ ₹30.36'),
      row('Delivery charge', '+ ₹168.64'),
    ],
    ProductDetailsForOrderList: [
      {
        ProductId: 3,
        ProductName: 'Eggs',
        MeasurementUnit: 'Tray',
        QtyOrdered: 4,
        QtyDispatched: 4,
        QuantityDelivered: 4,
        SubUom: 'pc',
        SubUomCount: 30,
        DetailsV2: { Unit: 'pc', Ordered: { Quantity: 120 }, Delivered: { Quantity: 120 } },
        Price: 192,
        OriginalPricePerUnit: 192,
        PricePerUnitInclTax: 192,
        TotalOrderPrice: 768,
        QuantityOrderedPrice: 718.08,
        QuantityDeliveredPrice: 718.08,
        GSTRate: 0,
        CessRate: 0,
        TaxAmount: 0,
        DiscountedQuantity: 2,
        DiscountedPricePerUnit: 167.04,
        DiscountMessage: '₹ 49.92 DISCOUNT APPLIED',
      },
    ],
    CreditNotes: [
      { CreditNoteNumber: 'PRODUCT-CN', Amount: 718.08, TicketId: 91, CreditNoteProducts: null },
      { CreditNoteNumber: 'DELIVERY-CN', Amount: 199, TicketId: 91, CreditNoteProducts: null },
    ],
  });
  const d = orderDetail(raw);
  assert.equal(d.returns.orderReturned, true);
  assert.equal(d.returns.returnedQuantity, null);
  assert.equal(d.items[0].quantity.delivered, 4);
  assert.equal(d.items[0].displayQuantity.delivered, 120);
  assert.equal(d.items[0].pricing.discount.discountedQuantity, 2);
  assert.equal(d.items[0].pricing.discount.discountedUnitPriceExTax, 167.04);
  assert.equal(d.totals.itemTaxAndCess, 0);
  assert.equal(d.totals.taxAndCessIncludingFees, 30.36);
  assert.equal(d.totals.creditNoteTotal, 917.08);
  assert.equal(d.reconciliation.status, 'matched');
  raw.TotalPrice = 918;
  assert.equal(orderDetail(raw).reconciliation.status, 'difference');
});

const memory = () => ({
  values: {},
  async read(k, v) {
    return structuredClone(this.values[k] ?? v);
  },
  async write(k, v) {
    this.values[k] = structuredClone(v);
  },
});
const now = Date.parse('2026-09-21T10:00:00Z');
const records = (n) =>
  Array.from({ length: n }, (_, i) => ({
    OrderId: 1000 - i,
    OrderNo: `ORDER-${1000 - i}`,
    CreationDatetime: new Date(Date.parse('2026-09-20T12:00:00Z') - i * 86400_000).toISOString(),
    Status: 'Delivered',
    TotalPrice: 100,
    ProductCount: 1,
  }));
function setup(rows) {
  const store = memory(),
    pager = new OrderHistory(store, 'test-signing-key', () => now);
  return {
    store,
    pager,
    context: {
      binding: 'outlet-A',
      firstPage: rows.slice(0, 20),
      fetchPage: async (p) => rows.slice((p - 1) * 20, p * 20),
    },
  };
}

test('date filters are inclusive India dates and reject impossible/reversed dates', async () => {
  assert.throws(() => filters({ dateFrom: '2026-02-30' }), /YYYY-MM-DD/);
  assert.throws(() => filters({ dateFrom: '2026-09-20', dateTo: '2026-09-19' }));
  const rows = records(4);
  rows[0].CreationDatetime = '2026-09-21T18:30:00Z';
  rows[1].CreationDatetime = '2026-09-21T18:29:59Z';
  rows[2].CreationDatetime = '2026-09-20T18:30:00Z';
  rows[3].CreationDatetime = '2026-09-20T18:29:59Z';
  const { store, context } = setup(rows),
    pager = new OrderHistory(store, 'test', () => Date.parse('2026-09-22T00:00:00Z'));
  const r = await pager.list({ dateFrom: '2026-09-21', dateTo: '2026-09-21' }, context);
  assert.deepEqual(r.orderIds, ['999', '998']);
  assert.equal(r.pagination.nextCursor, null);
});

test('pagination spans source pages, can replay a cursor, and rejects changes/tampering', async () => {
  const { pager, context } = setup(records(45));
  let r = await pager.list({ pageSize: 15 }, context);
  const ids = [...r.orderIds];
  const cursor = r.pagination.nextCursor;
  r = await pager.list({ cursor }, context);
  ids.push(...r.orderIds);
  assert.deepEqual(await pager.list({ cursor }, context), r);
  await assert.rejects(pager.list({ cursor, pageSize: 16 }, context), /CURSOR_FILTER_MISMATCH/);
  await assert.rejects(pager.list({ cursor: cursor + 'x' }, context), /INVALID_CURSOR/);
  r = await pager.list({ cursor: r.pagination.nextCursor }, context);
  ids.push(...r.orderIds);
  assert.equal(new Set(ids).size, 45);
  assert.equal(r.pagination.hasMore, false);
  assert.equal(r.pagination.totalMatched, 45);
  const first = await pager.list({ pageSize: 1 }, context);
  const changed = {
    ...context,
    firstPage: [{ ...context.firstPage[0], OrderId: 9999 }, ...context.firstPage.slice(1)],
  };
  await assert.rejects(
    pager.list({ cursor: first.pagination.nextCursor }, changed),
    /New or removed orders/,
  );
});

test('a far-back filter returns explicit incomplete empty pages and resumes without gaps', async () => {
  const { pager, context, store } = setup(records(130));
  const date = records(121).at(-1).CreationDatetime.slice(0, 10);
  const a = await pager.list({ dateFrom: date, dateTo: date }, context);
  assert.equal(a.orders.length, 0);
  assert.equal(a.pagination.hasMore, true);
  assert.equal(a.pagination.scanComplete, false);
  const b = await pager.list({ cursor: a.pagination.nextCursor }, context);
  assert.equal(b.orders.length, 1);
  assert.equal(b.pagination.hasMore, false);
  assert.equal(b.orderIds[0], '880');
  assert.ok(store.values['order-index'].orders['880']);
  const expired = new OrderHistory(store, 'test-signing-key', () => now + 3600_001);
  await assert.rejects(expired.list({ cursor: a.pagination.nextCursor }, context), /Start a fresh/);
});

test('empty history is complete; repeated upstream pages fail instead of looping', async () => {
  let x = setup([]);
  assert.equal((await x.pager.list({}, x.context)).pagination.hasMore, false);
  x = setup(records(40));
  x.context.fetchPage = async () => x.context.firstPage;
  await assert.rejects(x.pager.list({ pageSize: 30 }, x.context), /HISTORY_PAGINATION_STALLED/);
});
