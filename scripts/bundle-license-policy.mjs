import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const inventory = JSON.parse(readFileSync(new URL('./bundle-allowlist.json', import.meta.url), 'utf8'));
export const forbiddenPatterns = ['**/node_modules/@anthropic-ai/claude-agent-sdk{,-*}{,/**/*}', '**/node_modules/@cursor/sdk{,-*}{,/**/*}', '**/node_modules/@github/copilot{,-*}{,/**/*}', '**/node_modules/@paperclipai/server/provider-assets/copilot{,/**/*}'];
export function forbiddenPath(path) {
  return /(?:^|\/)node_modules\/(?:@anthropic-ai\/claude-agent-sdk(?:-[^/]+)?|@cursor\/sdk(?:-[^/]+)?|@github\/copilot(?:-[^/]+)?)(?:\/|$)/.test(path.replaceAll('\\', '/')) || /(?:^|\/)node_modules\/@paperclipai\/server\/provider-assets\/copilot(?:\/|$)/.test(path.replaceAll('\\', '/'));
}
export function checkLock(lock, approved = inventory) {
  let checked = 0;
  for (const [path, pkg] of Object.entries(lock.packages ?? {})) {
    if (!path || pkg.dev) continue;
    checked++;
    const expected = approved[path];
    if (forbiddenPath(path)) throw new Error(`Restricted dependency: ${path}`);
    if (!expected || expected.version !== pkg.version || expected.license !== (pkg.license || 'UNKNOWN')) throw new Error(`Unreviewed production dependency: ${path}`);
  }
  if (!checked) throw new Error('No production dependencies checked');
  return checked;
}
export function assertConfig(config, normalized = false) {
  const filters = (config.files ?? []).flatMap(file => typeof file === 'string' ? [file] : file.filter || []);
  if ((!normalized && config.afterPack !== 'scripts/bundle-after-pack.mjs') || !forbiddenPatterns.every(pattern => filters.includes('!' + pattern))) throw new Error('Packaging license exclusions or afterPack gate missing');
}
export function checkStagedPaths(paths) {
  let checked = 0;
  const allowed = new Set(Object.values(inventory).map(pkg => pkg.name));
  for (const path of paths) {
    if (forbiddenPath(path)) throw new Error(`Restricted bundled content: ${path}`);
    const match = path.replaceAll('\\', '/').match(/(?:^|\/)node_modules\/(@[^/]+\/[^/]+|[^@/][^/]*)/g);
    for (const part of match || []) {
      const name = part.replace(/^\/?node_modules\//, '');
      if (!allowed.has(name)) throw new Error(`Unreviewed bundled dependency: ${name}`);
      checked++;
    }
  }
  if (!checked) throw new Error('No bundled dependency entries checked');
  return checked;
}
export function walkFiles(root, prefix = '') {
  return readdirSync(resolve(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Unexpected packaged symlink: ${path}`);
    return [path, ...(entry.isDirectory() ? walkFiles(root, path) : [])];
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const count = checkLock(JSON.parse(readFileSync('package-lock.json', 'utf8')));
  assertConfig(JSON.parse(readFileSync('package.json', 'utf8')).build);
  console.log(JSON.stringify({ ok: true, productionPackagesChecked: count, restrictedSdkFamilies: 4, scope: 'dependency inventory and packaging configuration; not a distribution license clearance' }));
}
