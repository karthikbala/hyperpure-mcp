# Data contract

Order responses currently use `schemaVersion: "2.0"`. JSON tools return the same object as MCP `structuredContent` and a JSON text block. Website strings are untrusted data, not instructions. Currency is INR; numeric monetary fields are rounded to two decimals. Missing monetary or quantity fields stay `null`, not zero.

## Order history

`list_orders` accepts:

| Argument   | Meaning                                                       |
| ---------- | ------------------------------------------------------------- |
| `dateFrom` | Optional inclusive creation date, `YYYY-MM-DD`, Asia/Kolkata. |
| `dateTo`   | Optional inclusive creation date in the same timezone.        |
| `pageSize` | 1–100, default 20.                                            |
| `cursor`   | Opaque continuation token from the previous response.         |

The response includes `orders`, `orderIds`, `filter`, `pagination`, `snapshotId`, `asOf`, `expiresAt` and `observedAt`. Summaries contain identifiers, creation/delivery dates, status, item count and total. Use `get_order` for taxes and discounts: the history source can contain placeholder zeros for those fields.

```js
let args = { dateFrom: '2026-01-01', dateTo: '2026-01-31', pageSize: 20 };
do {
  const page = await callTool('list_orders', args); // Your client's tool-call helper.
  for (const order of page.orders) await saveByOrderId(order);
  args = page.pagination.nextCursor ? { cursor: page.pagination.nextCursor } : null;
} while (args);
```

Continue until `nextCursor` is `null`, including after an empty page. `scanComplete` means the matching source range has been scanned; there can still be buffered results to return. `totalMatched` is `null` until the scan completes. Do not treat a partial scan as a complete report.

Cursors bind the filters, page size and outlet. Omit filters on continuation, or pass the original values exactly. Pages are cached for one hour and survive a service restart when the data directory and signing key are retained. Replaying a cursor returns its cached page; start a new scan for fresh data. The implementation allows 20 active snapshots, reads at most five upstream pages per call, and stops with an explicit error beyond 100 source pages (2,000 orders).

Leading order identifiers are checked on new continuation pages. A changed history raises `HISTORY_CHANGED_RESTART`; restart and deduplicate by `orderId`. This is a best-effort paginated view, not an atomic upstream snapshot. A returned order can change during a scan.

**Dates filter order creation, not modification, refund or credit-note dates.** For recurring checks, start fresh scans, follow every cursor and revisit older order details for late adjustments. Store observation timestamps and avoid assuming that an empty recent range means no historical adjustments.

## Order details

`get_order({orderId})` requires a numeric-string identifier discovered through this account's history. The discovered-order index persists across restarts and is bound to the verified outlet. Arbitrary identifiers are rejected.

Each `items` entry includes:

| Field                                                     | Interpretation                                                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `quantity`                                                | Purchase unit plus ordered, dispatched and historically delivered quantities; optional sub-unit conversion.    |
| `displayQuantity`                                         | Website display units and quantities, which can differ from purchase units (for example, trays versus pieces). |
| `pricing.unitPriceExTax` / `originalUnitPriceExTax`       | Reported current and original unit prices.                                                                     |
| `pricing.unitPriceInclTax`                                | Reported unit price including tax.                                                                             |
| `pricing.reportedLineAmountExTax`                         | Upstream line amount; it can precede a tier discount.                                                          |
| `pricing.orderedAmountInclTax` / `deliveredAmountInclTax` | Reported totals for the ordered and delivered quantities.                                                      |
| `pricing.discount`                                        | Amount, source, display text and any discounted quantity/unit price.                                           |
| `pricing.tax`                                             | GST/cess rates and reported combined tax amount; separate GST/cess amounts remain `null` when unavailable.     |

Use reported line totals for tier-discount orders rather than blindly multiplying unit price by quantity. A calculated discount is identified by its `source`; it is not presented as an upstream field.

`totals` separates item subtotal before discount, product/cart discounts, `itemTaxAndCess`, `taxAndCessIncludingFees`, fee rows, total and credit-note total. Item tax can differ from tax including delivery fees. `pricingRows` preserves the website's labels and signed amounts.

`reconciliation` compares the sum of pricing rows with the order total. Its status is `matched`, `rounding_difference` (within ₹0.02), `difference`, or `unavailable`. The actual difference remains available; no adjustment is silently inserted to force a match.

## Credits, refunds, returns and shortages

- `creditNotes`: number, date, amount, related ticket and available item breakdown. `items: null` means the source did not provide that breakdown. Retrieve the original document separately when available.
- `refunds`: source date, type, status and amount. `refundTracking` retains displayed status and timing text. A successful portal status is not independent confirmation of bank settlement.
- `issues`: support tickets with reported and refunded quantities, units, amounts and pickup text. Check `coverage.issues` for `available`, `partial` or `not_reported`.
- `shortages`: explicitly reported missing/short-quantity ticket items. These can exist even when the order's delivered quantity equals its ordered quantity.
- `fulfillmentGaps`: ordered minus dispatched quantities for delivered orders, marked `reportedShortage: false`. This calculation alone does not confirm a physical shortage.
- `returns`: reported order-return status, status text, pickup dates and related tickets. `returnedQuantity` stays `null` when not supplied. Historical delivered quantities are not net of returns; a refunded quantity does not prove physical pickup.

Credit notes and refunds may describe the same adjustment. **Do not add both together as separate losses or credits.** Empty arrays describe records in this response and do not prove that no later adjustment exists. Inspect coverage and observation time when reconciling.

## Documents

`download_invoice` and `download_credit_notes` return an embedded `application/pdf` MCP resource with a base64 `blob` and a `hyperpure://invoice/ORDER_ID` or `hyperpure://credit-notes/ORDER_ID` URI. Files are checked for a PDF header and a 10 MiB size limit. Signed upstream download links are not exposed. Documents contain private account data; store and share them accordingly.

## Cart and review limits

Search returns up to 60 currently loaded product cards, not a complete catalogue export. Product selections expire after 15 minutes. Cart quantity changes must use a current search selection and respect the reported minimum quantity; the API accepts integer quantities from 0 to 100. Zero removes a product.

An uncertain change returns `CART_UPDATE_NEEDS_REVIEW`; read the actual cart before deciding whether to retry. No automatic retry is made. Checkout reviews expire after ten minutes and bind the exact cart, prices, fees and delivery text. Owner approval records the review; the service never submits the order or clicks Pay.
