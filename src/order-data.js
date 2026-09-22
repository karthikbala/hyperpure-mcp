import { ServiceError } from './core.js';

export const number = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
export const money = (value) =>
  number(value) === null ? null : Math.round((value + Number.EPSILON) * 100) / 100;
export const plain = (value) =>
  typeof value === 'string'
    ? value
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .trim()
    : null;
export function amount(value) {
  const text = plain(value);
  if (/^FREE$/i.test(text || '')) return 0;
  const match = text?.match(/(-\s*)?₹\s*([\d,]+(?:\.\d+)?)/);
  return match ? money(Number(match[2].replaceAll(',', '')) * (match[1] ? -1 : 1)) : null;
}
export function quantity(value) {
  const text = plain(value),
    match = text?.match(/^([\d,.]+)\s+(.+)$/);
  return {
    value: match ? Number(match[1].replaceAll(',', '')) : null,
    unit: match?.[2] || null,
    displayText: text,
  };
}
const sum = (values) =>
  values.every((v) => number(v) !== null) ? money(values.reduce((a, b) => a + b, 0)) : null;
const textList = (value) =>
  !value
    ? []
    : typeof value === 'string'
      ? [plain(value)]
      : Array.isArray(value)
        ? value.flatMap(textList)
        : Object.entries(value)
            .filter(([k]) => ['Text', 'Title', 'SubTitle', 'Value'].includes(k))
            .flatMap(([, v]) => textList(v));

export function orderSummary(raw) {
  if (
    !Number.isSafeInteger(raw.OrderId) ||
    !raw.OrderNo ||
    !Number.isFinite(Date.parse(raw.CreationDatetime))
  )
    throw new ServiceError('ORDER_SCHEMA_CHANGED', 'Order identity or creation date is missing.');
  return {
    orderId: String(raw.OrderId),
    orderNumber: raw.OrderNo,
    createdAt: raw.CreationDatetime,
    deliveredAt: raw.DeliveredAt || null,
    targetDeliveryAt: raw.TargetDeliveryDate || null,
    status: raw.Status || null,
    paymentStatus: raw.PaymentStatus || null,
    orderType: raw.OrderType || null,
    itemCount: number(raw.ProductCount),
    currency: 'INR',
    total: money(raw.TotalPrice),
    creditNotesAvailable: Array.isArray(raw.CreditNotes) ? raw.CreditNotes.length > 0 : null,
    // History contains placeholder zeros for taxes/discounts. Only detail exposes those fields.
  };
}

function item(raw) {
  const ordered = number(raw.QtyOrdered),
    dispatched = number(raw.QtyDispatched),
    delivered = number(raw.QuantityDelivered);
  const base = money(raw.Price),
    original = money(raw.OriginalPricePerUnit),
    discountedQty = number(raw.DiscountedQuantity);
  const reportedDiscount = amount(raw.DiscountMessage);
  const computedDiscount =
    ordered !== null && base !== null && original !== null && discountedQty === 0
      ? money((original - base) * ordered)
      : null;
  return {
    productId: raw.ProductId == null ? null : String(raw.ProductId),
    productNumber: raw.ProductNumber == null ? null : String(raw.ProductNumber),
    name: raw.ProductName || null,
    category: raw.CategoryName || null,
    quantity: {
      unit: raw.MeasurementUnit || null,
      ordered,
      dispatched,
      delivered,
      subUnit: raw.SubUom || null,
      subUnitsPerUnit: number(raw.SubUomCount),
    },
    displayQuantity: {
      unit: raw.DetailsV2?.Unit || null,
      ordered: number(raw.DetailsV2?.Ordered?.Quantity),
      delivered: number(raw.DetailsV2?.Delivered?.Quantity),
    },
    pricing: {
      currency: 'INR',
      unitPriceExTax: base,
      originalUnitPriceExTax: original,
      unitPriceInclTax: money(raw.PricePerUnitInclTax),
      reportedLineAmountExTax: money(raw.TotalOrderPrice),
      orderedAmountInclTax: money(raw.QuantityOrderedPrice),
      deliveredAmountInclTax: money(raw.QuantityDeliveredPrice),
      discount: {
        amount: reportedDiscount ?? computedDiscount,
        source:
          reportedDiscount !== null
            ? 'displayed_discount'
            : computedDiscount !== null
              ? 'original_minus_base_price'
              : 'not_reported',
        displayText: plain(raw.DiscountMessage),
        discountedQuantity: discountedQty,
        discountedUnitPriceExTax: discountedQty > 0 ? money(raw.DiscountedPricePerUnit) : null,
      },
      tax: {
        gstRatePercent: number(raw.GSTRate),
        cessRatePercent: number(raw.CessRate),
        amount: money(raw.TaxAmount),
        gstAmount: null,
        cessAmount: null,
      },
    },
    creditNoteNumbers: Array.isArray(raw.CreditNoteNo)
      ? raw.CreditNoteNo
      : raw.CreditNoteNo
        ? [raw.CreditNoteNo]
        : [],
    creditNoteGenerated:
      typeof raw.IsCreditNoteGenerated === 'boolean' ? raw.IsCreditNoteGenerated : null,
  };
}

function issue(raw) {
  return {
    ticketId: raw.TicketId == null ? null : String(raw.TicketId),
    status: plain(raw.CardTitle?.TitleTag?.Text),
    reportedOn: plain(raw.SubTitle),
    pickedUpOn: plain(raw.PickedupDate) || null,
    issueAmount: amount(raw.TotalIssuePrice?.Value),
    refundAmount: amount(raw.TotalRefundPrice?.Value),
    refundNote: plain(raw.RefundNote) || null,
    products: (raw.Products || []).map((p) => ({
      name: plain(p.Name),
      issueType: plain(p.IssueType?.Value),
      issueQuantity: quantity(p.IssueQty?.Value),
      refundQuantity: quantity(p.RefundQty?.Value),
      issueAmount: amount(p.IssuePrice?.Value),
      refundAmount: amount(p.RefundPrice?.Value),
      comment: plain(p.Comment) || null,
    })),
  };
}

export function orderDetail(raw) {
  const summary = orderSummary(raw);
  if (!Array.isArray(raw.ProductDetailsForOrderList) || !Array.isArray(raw.PricingDetails))
    throw new ServiceError(
      'ORDER_SCHEMA_CHANGED',
      'Structured order items or pricing are missing.',
    );
  const items = raw.ProductDetailsForOrderList.map(item);
  if (
    items.some(
      (i) => !i.name || i.quantity.ordered === null || i.pricing.orderedAmountInclTax === null,
    )
  )
    throw new ServiceError('ORDER_SCHEMA_CHANGED', 'An order item could not be read completely.');
  const pricingRows = raw.PricingDetails.map((p) => ({
    label: plain(p.Title),
    displayText: plain(p.Value),
    amount: amount(p.Value),
  }));
  const gstRow = pricingRows.find((p) => /^GST\s*\+\s*Cess$/i.test(p.label));
  const issues = (raw.IssueHistory?.IssueDetails || []).map(issue);
  const creditNotes = Array.isArray(raw.CreditNotes)
    ? raw.CreditNotes.map((c) => ({
        number: c.CreditNoteNumber || null,
        createdAt: c.CreatedAt || null,
        amount: money(c.Amount),
        ticketId: c.TicketId == null ? null : String(c.TicketId),
        deliveryChargeRefundText: plain(c.DeliveryChargeRefundString) || null,
        itemBreakdownAvailable:
          Array.isArray(c.CreditNoteProducts) && c.CreditNoteProducts.length > 0,
        // This source currently supplies null even for real credit notes; never invent tax/item splits.
        items: Array.isArray(c.CreditNoteProducts)
          ? c.CreditNoteProducts.map((p) => ({
              name: plain(p.ProductName),
              quantity: number(p.Quantity),
              amount: money(p.Amount),
              taxAmount: money(p.TaxAmount),
            }))
          : null,
      }))
    : null;
  const refunds = Array.isArray(raw.Refunds)
    ? raw.Refunds.map((r) => ({
        date: r.RefundDate || null,
        type: r.RefundType || null,
        status: r.RefundStatus || null,
        amount: money(r.RefundAmount),
      }))
    : null;
  const refundTracking = (raw.RefundDetailsV2?.Instances || []).flatMap((r) =>
    (r.Modes || []).map((m) => ({
      reason: plain(r.Reason),
      status: plain(m.Status?.Text),
      amount: amount(m.Heading),
      description: plain(m.Heading),
      creditedOn: plain(m.Timestamp),
    })),
  );
  const returnText = [...textList(raw.ReturnStatusV2), ...textList(raw.ReturnStatus)].filter(
    Boolean,
  );
  const orderReturned =
    /returned/i.test(summary.status || '') || returnText.some((t) => /order returned/i.test(t));
  const shortages = issues.flatMap((t) =>
    t.products
      .filter((p) => /less quantity|shortage|missing|not received/i.test(p.issueType || ''))
      .map((p) => ({
        ticketId: t.ticketId,
        status: t.status,
        name: p.name,
        issueType: p.issueType,
        reportedIssueQuantity: p.issueQuantity,
        refundedQuantity: p.refundQuantity,
        refundAmount: p.refundAmount,
        source: 'support_ticket',
      })),
  );
  const fulfillmentGaps = /^delivered$/i.test(summary.status || '')
    ? items
        .filter(
          (i) =>
            i.quantity.ordered !== null &&
            i.quantity.dispatched !== null &&
            i.quantity.ordered > i.quantity.dispatched,
        )
        .map((i) => ({
          productId: i.productId,
          name: i.name,
          quantity: money(i.quantity.ordered - i.quantity.dispatched),
          unit: i.quantity.unit,
          source: 'ordered_minus_dispatched',
          reportedShortage: false,
        }))
    : [];
  const pricingSum = sum(pricingRows.map((p) => p.amount)),
    total = money(raw.TotalPrice);
  const difference = pricingSum !== null && total !== null ? money(total - pricingSum) : null;
  const issuesKnown = typeof raw.IssueHistory?.TotalIssueCount === 'number';
  return {
    ...summary,
    schemaVersion: '2.0',
    items,
    totals: {
      currency: 'INR',
      itemSubtotalBeforeDiscount: money(raw.SubTotal),
      productDiscount: money(raw.Discount),
      cartDiscount: money(raw.CartLevelDiscount),
      itemTaxAndCess: money(raw.TotalTax),
      taxAndCessIncludingFees: gstRow?.amount ?? null,
      fees: pricingRows.filter(
        (p) => !/^Item total$|discount|^GST\s*\+\s*Cess$/i.test(p.label || ''),
      ),
      total,
      creditNoteTotal: creditNotes === null ? null : sum(creditNotes.map((c) => c.amount)),
    },
    pricingRows,
    creditNotes,
    refunds,
    refundTracking,
    issues,
    returns: {
      orderReturned,
      statusText: returnText,
      returnedQuantity: null,
      pickedUpDates: issues.map((i) => i.pickedUpOn).filter(Boolean),
      relatedTicketIds: orderReturned ? issues.map((i) => i.ticketId) : [],
      note: 'Delivered quantities are source history, not net of returns. A refunded or refund-eligible quantity does not prove physical pickup.',
    },
    shortages,
    fulfillmentGaps,
    coverage: {
      items: 'order_detail',
      issues: issuesKnown
        ? raw.IssueHistory.TotalIssueCount > issues.length
          ? 'partial'
          : 'available'
        : 'not_reported',
      creditNoteItems:
        creditNotes?.length === 0
          ? 'not_applicable'
          : creditNotes?.every((c) => c.itemBreakdownAvailable)
            ? 'available'
            : 'not_reported',
      note: 'Empty arrays mean no records in this response; they do not prove that no later adjustment exists. Refund and credit-note records may describe the same adjustment; do not add them together.',
    },
    reconciliation: {
      pricingRowsTotal: pricingSum,
      orderTotal: total,
      difference,
      roundingTolerance: 0.02,
      status:
        difference === null
          ? 'unavailable'
          : difference === 0
            ? 'matched'
            : Math.abs(difference) <= 0.02
              ? 'rounding_difference'
              : 'difference',
    },
    invoiceAvailable: !!raw.InvoiceSignedPath,
    creditNoteDownloadAvailable: !!raw.RefundDetailsV2?.DownloadPath,
    source: {
      type: 'authenticated_hyperpure_order_detail',
      sourceUrl: `https://www.hyperpure.com/z/buyer/order/${summary.orderId}`,
    },
    observedAt: new Date().toISOString(),
  };
}
