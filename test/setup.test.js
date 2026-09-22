import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { configure } from '../src/setup.js';
test('new installations generate separate secrets, exact outlet binding and private client settings without overwriting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hyperpure-setup-'));
  try {
    const options = {
      directory,
      origin: 'https://hyperpure.example.com',
      mobile: '9000000000',
      outletName: ' Example  Kitchen: ',
      outletAddress: '1 Example Road',
    };
    const result = await configure(options),
      env = parseEnv(await readFile(join(directory, '.env'), 'utf8'));
    assert.equal(env.PUBLIC_ORIGIN, options.origin);
    assert.notEqual(env.MCP_TOKEN, env.OWNER_KEY);
    assert.ok(env.MCP_TOKEN.length >= 32);
    const binding = JSON.parse(await readFile(join(result.dataDir, 'binding.json'), 'utf8'));
    assert.equal(binding.text, 'Example Kitchen: 1 Example Road');
    const client = JSON.parse(await readFile(join(directory, '.secrets/connection.json'), 'utf8'));
    assert.equal(client.mcpServers.hyperpure.headers.Authorization, 'Bearer ' + env.MCP_TOKEN);
    assert.equal((await stat(join(directory, '.env'))).mode & 0o777, 0o600);
    await assert.rejects(configure(options), /not overwritten/);
    assert.equal(
      parseEnv(await readFile(join(directory, '.env'), 'utf8')).MCP_TOKEN,
      env.MCP_TOKEN,
    );
    await assert.rejects(configure({ ...options, origin: 'http://example.com' }), /HTTPS/);
    await assert.rejects(configure({ ...options, mobile: 'invalid' }), /10-digit/);
  } finally {
    await rm(directory, { recursive: true });
  }
});
