import test from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalStore, SerialQueue, sameSecret } from '../src/core.js';
const memory = () => ({
  value: null,
  async read() {
    return structuredClone(this.value);
  },
  async write(_, v) {
    this.value = structuredClone(v);
  },
});
test('checkout rejects changed price, expired approval, and a second submission', async () => {
  let time = 100;
  const approvals = new ApprovalStore(memory(), () => time);
  const cart = { outlet: 'cafe', items: [{ id: 'milk', qty: 2 }], total: 140 };
  const a = await approvals.prepare(cart);
  await assert.rejects(approvals.approve(a.id, { ...cart, total: 141 }));
  await approvals.approve(a.id, cart);
  await assert.rejects(approvals.approve(a.id, cart));
  const b = await approvals.prepare(cart);
  time += 600_001;
  await assert.rejects(approvals.approve(b.id, cart));
});
test('browser requests serialize and recover after failure', async () => {
  const q = new SerialQueue(),
    events = [];
  const a = q.run(async () => {
    events.push('a');
    await new Promise((r) => setTimeout(r, 10));
    throw Error('failure');
  });
  const b = q.run(async () => events.push('b'));
  await assert.rejects(a);
  await b;
  assert.deepEqual(events, ['a', 'b']);
});
test('secrets reject missing and nonmatching values', () => {
  assert.equal(sameSecret('a', 'a'), true);
  assert.equal(sameSecret(undefined, 'a'), false);
  assert.equal(sameSecret('a', 'b'), false);
});
