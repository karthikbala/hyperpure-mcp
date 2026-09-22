// Optional checks against your deployment. No cart writes, checkout or OTP requests.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const { PUBLIC_ORIGIN: origin, MCP_TOKEN: token, TEST_SEARCH_QUERY: query } = process.env;
if (!origin?.startsWith('https://') || !token)
  throw Error('Set PUBLIC_ORIGIN and MCP_TOKEN in your private .env first.');
const client = new Client({ name: 'hyperpure-readonly-smoke', version: '0.4.0' });
let accountReference, outletReference;
function checkIdentity(result) {
  const identity = result.structuredContent?.identity;
  assert.ok(identity?.account.reference && identity.outlet.reference, 'Response identity missing');
  assert.ok(identity.outlet.name && identity.outlet.address, 'Outlet labels missing');
  accountReference ??= identity.account.reference;
  outletReference ??= identity.outlet.reference;
  assert.ok(
    identity.account.reference === accountReference &&
      identity.outlet.reference === outletReference,
    'Response identity changed',
  );
  return identity;
}
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 });
  // Do not print upstream messages or private payloads in test output.
  assert.ok(!result.isError, `${name} failed; inspect your owner page and private service logs.`);
  assert.equal(checkIdentity(result).verification, 'outlet_verified');
  const resource = result.content.find((c) => c.type === 'resource');
  if (resource) return { ...result.structuredContent, ...resource.resource };
  if (result.structuredContent) return result.structuredContent;
  const content = result.content[0];
  return content.type === 'resource' ? content.resource : JSON.parse(content.text);
}
try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL('/mcp', origin), {
      requestInit: { headers: { Authorization: 'Bearer ' + token } },
    }),
  );
  const names = new Set((await client.listTools()).tools.map((tool) => tool.name));
  for (const name of [
    'session_status',
    'search_products',
    'get_cart',
    'set_cart_quantity',
    'list_orders',
    'get_order',
    'download_invoice',
    'download_credit_notes',
    'prepare_checkout_review',
  ])
    assert.ok(names.has(name));
  assert.equal(
    (await call('session_status')).state,
    'READY',
    'Log in and verify your outlet in the owner page first.',
  );
  console.log('PASS tool discovery and authenticated session');
  assert.ok(Array.isArray((await call('get_cart')).items));
  console.log('PASS cart read');
  const first = await call('list_orders', { pageSize: 1 });
  const comparisons = [...first.orders];
  assert.ok(Array.isArray(first.orders));
  if (first.pagination.nextCursor) {
    const args = { cursor: first.pagination.nextCursor },
      second = await call('list_orders', args);
    comparisons.push(...second.orders);
    assert.ok(
      isDeepStrictEqual(await call('list_orders', args), second),
      'Cursor replay changed; inspect the account privately.',
    );
    const ids = [...first.orderIds, ...second.orderIds];
    assert.equal(new Set(ids).size, ids.length);
    console.log('PASS cursor continuation and stable replay');
  }
  for (const summary of comparisons) {
    const detail = await call('get_order', { orderId: summary.orderId });
    assert.ok(detail.deliveredAt === summary.deliveredAt, 'History/detail delivery mismatch');
    assert.equal(detail.deliveryTimestamp.source, 'order_history.DeliveredAt');
    assert.ok(detail.identity.outlet.id, 'Verified API outlet ID missing');
  }
  console.log('PASS canonical delivery timestamps and consistent account/outlet identity');
  const unknown = await client.callTool({ name: 'get_order', arguments: { orderId: '1' } });
  assert.equal(unknown.isError, true);
  checkIdentity(unknown);
  const invalid = await client.callTool({ name: 'list_orders', arguments: { pageSize: 0 } });
  assert.equal(invalid.isError, true);
  assert.equal(checkIdentity(invalid).verification, 'unverified');
  console.log('PASS identity on operation and input-validation errors');
  if (first.orders.length) {
    const detail = await call('get_order', { orderId: first.orders[0].orderId });
    assert.ok(detail.orderId === first.orders[0].orderId, 'Order identity mismatch');
    assert.ok(Array.isArray(detail.items));
    assert.ok(detail.totals);
    assert.ok(detail.coverage);
    for (const item of detail.items) {
      assert.ok(item.quantity);
      assert.ok(item.pricing);
    }
    console.log('PASS structured order detail');
    if (detail.invoiceAvailable) {
      const pdf = await call('download_invoice', { orderId: detail.orderId });
      assert.equal(pdf.mimeType, 'application/pdf');
      assert.equal(Buffer.from(pdf.blob, 'base64').subarray(0, 5).toString(), '%PDF-');
      console.log('PASS invoice PDF');
    }
  } else console.log('SKIP order detail: no orders returned on the first page');
  if (query) {
    await call('search_products', { query });
    console.log('PASS optional product search');
  }
  console.log('Read-only smoke checks completed. No account payloads were printed.');
} finally {
  await client.close();
}
