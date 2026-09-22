import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { configure } from '../src/setup.js';
if (!stdin.isTTY) throw Error('Run npm run configure in an interactive terminal.');
const rl = createInterface({ input: stdin, output: stdout });
try {
  const origin = await rl.question('Public HTTPS origin (e.g. https://hyperpure.example.com): ');
  const mobile = await rl.question('Hyperpure mobile number (10 digits): ');
  const outletName = await rl.question('Exact outlet name shown in Hyperpure: ');
  const outletAddress = await rl.question('Exact delivery address shown in Hyperpure: ');
  const dataDir = await rl.question('Private data directory [./data]: ');
  const result = await configure({
    origin,
    mobile,
    outletName,
    outletAddress,
    dataDir: dataDir || undefined,
  });
  console.log(
    `Configured ${result.origin}. Secrets are in .env and .secrets/ (owner-only permissions).\nStart the service, then unlock ${result.origin}/owner using .secrets/owner-access.txt.`,
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  rl.close();
}
