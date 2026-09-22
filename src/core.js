import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';

export class ServiceError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}
export const token = () => randomBytes(32).toString('base64url');
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export function sameSecret(a, b) {
  return (
    typeof a === 'string' &&
    typeof b === 'string' &&
    timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)))
  );
}
export class SerialQueue {
  tail = Promise.resolve();
  count = 0;
  run(fn) {
    if (this.count >= 12) throw new ServiceError('BUSY', 'Browser queue is full; retry later.');
    this.count++;
    const result = this.tail.then(fn);
    this.tail = result
      .catch(() => {})
      .finally(() => {
        this.count--;
      });
    return result;
  }
}
export class JsonStore {
  constructor(directory) {
    this.directory = directory;
  }
  async read(name, fallback) {
    try {
      return JSON.parse(await readFile(`${this.directory}/${name}.json`, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return fallback;
      throw e;
    }
  }
  async write(name, value) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = `${this.directory}/${name}.json`;
    await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  }
}

// Approval binds to the entire reviewed cart; it is never an MCP-supplied boolean.
export class ApprovalStore {
  constructor(store, now = Date.now) {
    this.store = store;
    this.now = now;
  }
  async prepare(snapshot) {
    const value = {
      id: token(),
      cartHash: digest(JSON.stringify(snapshot)),
      snapshot,
      status: 'PENDING',
      expiresAt: this.now() + 10 * 60_000,
    };
    await this.store.write('checkout', value);
    return value;
  }
  async approve(id, snapshot) {
    const current = await this.store.read('checkout', null);
    if (
      !current ||
      !sameSecret(id, current.id) ||
      current.status !== 'PENDING' ||
      current.expiresAt < this.now() ||
      current.cartHash !== digest(JSON.stringify(snapshot))
    ) {
      throw new ServiceError(
        'APPROVAL_EXPIRED_OR_CART_CHANGED',
        'Review a fresh checkout before approving.',
      );
    }
    // Persist before submitting, so a crash can never cause automatic replay.
    current.status = 'SUBMITTING';
    await this.store.write('checkout', current);
    return current;
  }
  async finish(status, receipt) {
    const current = await this.store.read('checkout', null);
    if (!current || current.status !== 'SUBMITTING') throw new ServiceError('NO_SUBMISSION');
    await this.store.write('checkout', { ...current, status, receipt });
  }
}
