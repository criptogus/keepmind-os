import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Scan tracked and untracked, non-ignored text without printing secret values.
const output = await new Promise((resolve, reject) => {
  const child = spawn('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  const chunks = [];
  child.stdout.on('data', (chunk) => chunks.push(chunk));
  child.on('error', reject);
  child.on('close', (code) => code === 0
    ? resolve(Buffer.concat(chunks).toString())
    : reject(new Error('git file enumeration failed')));
});
const files = output.split('\0').filter(Boolean);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
];
let findings = 0;
for (const file of new Set(files)) {
  const data = readFileSync(file);
  if (data.includes(0)) continue;
  if (patterns.some((pattern) => pattern.test(data.toString('utf8')))) {
    console.error(`Possible secret in ${file}`);
    findings++;
  }
}
console.log(`Scanned ${new Set(files).size} files; ${findings} possible secrets.`);
process.exitCode = findings ? 1 : 0;
