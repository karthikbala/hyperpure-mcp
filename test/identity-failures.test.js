import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { HyperpureBrowser } from '../src/browser.js';
import { toolMessageDecorator, toolResult } from '../src/responses.js';

function browserFixture() {
  const binding = {
    text: 'Example Kitchen: Example Road',
    parts: ['Example Kitchen:', 'Example Road'],
  };
  const store = {
    values: { binding },
    async read(key, fallback) {
      return structuredClone(this.values[key] ?? fallback);
    },
    async write(key, value) {
      this.values[key] = structuredClone(value);
    },
  };
  const browser = new HyperpureBrowser({ mobile: '9000000000', mcpToken: 'test-token' }, store);
  browser.identityKey = 'test-key';
  browser.identityBinding = binding;
  browser.requireReady = async () => {
    browser.state = 'READY';
  };
  browser.assertOutlet = async () => {};
  browser.page = { goto: async () => {} };
  const respond = (status, body, outletId) => {
    browser.page.waitForResponse = async () => ({
      request: () => ({ allHeaders: async () => ({ 'x-outletid': outletId }) }),
      status: () => status,
      json: async () => {
        if (body instanceof Error) throw body;
        return body;
      },
    });
  };
  return { browser, store, respond };
}

test('failed history responses cannot pin or claim a verified outlet ID', async (t) => {
  for (const [name, status, body] of [
    ['expired session', 401, {}],
    ['source unavailable', 503, {}],
    ['malformed JSON', 200, new SyntaxError('Invalid JSON')],
    ['upstream error', 200, { error: true }],
    ['missing history array', 200, { response: {} }],
  ]) {
    await t.test(name, async () => {
      const { browser, store, respond } = browserFixture();
      respond(status, body, '42');
      await assert.rejects(browser.openOrderHistory());
      assert.equal(store.values['api-outlet'], undefined);
      assert.equal(browser.identity().outlet.id, null);
      assert.equal(browser.identity().outlet.idSource, null);
      respond(200, { response: { ListOfOrderDetail: [] } }, '43');
      await browser.openOrderHistory();
      assert.equal(store.values['api-outlet'].outletId, '43');
      assert.equal(browser.identity().outlet.id, '43');
      respond(401, {}, '43');
      await assert.rejects(browser.openOrderHistory());
      assert.equal(browser.identity().outlet.id, '43');
      assert.equal(browser.identity().verification, 'unverified');
    });
  }
});

test('real SDK responses include identity for single and batch tool errors only', async () => {
  const identity = { account: { reference: 'synthetic-account' }, verification: 'unverified' };
  const app = express();
  app.use(express.json());
  app.post('/mcp', async (req, res) => {
    const server = new McpServer({ name: 'identity-regression', version: '1.0.0' });
    server.registerTool('example', { inputSchema: { count: z.number().min(1) } }, async () =>
      toolResult({ ok: true }, { ...identity, verification: 'outlet_verified' }),
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const send = transport.send.bind(transport);
    const decorate = toolMessageDecorator(req.body, () => identity);
    transport.send = (message, options) => send(decorate(message), options);
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  const http = app.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const request = async (body) => {
    const response = await fetch(`http://127.0.0.1:${http.address().port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'Mcp-Protocol-Version': '2025-03-26',
      },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const invalid = {
    jsonrpc: '2.0',
    id: 0,
    method: 'tools/call',
    params: { name: 'example', arguments: { count: 0 } },
  };
  try {
    const single = await request(invalid);
    assert.equal(single.result.isError, true);
    assert.deepEqual(single.result.structuredContent.identity, identity);
    const batch = await request([
      invalid,
      { ...invalid, id: 'unknown', params: { name: 'missing', arguments: {} } },
      { ...invalid, id: 'success', params: { name: 'example', arguments: { count: 1 } } },
      { jsonrpc: '2.0', id: 'list', method: 'tools/list' },
    ]);
    assert.ok(Array.isArray(batch));
    for (const id of [0, 'unknown']) {
      const response = batch.find((message) => message.id === id);
      assert.equal(response.result.isError, true);
      assert.deepEqual(response.result.structuredContent.identity, identity);
    }
    assert.equal(
      batch.find((message) => message.id === 'success').result.structuredContent.identity
        .verification,
      'outlet_verified',
    );
    const list = batch.find((message) => message.id === 'list');
    assert.ok(Array.isArray(list.result.tools));
    assert.equal(list.result.structuredContent, undefined);
  } finally {
    await new Promise((resolve, reject) =>
      http.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
