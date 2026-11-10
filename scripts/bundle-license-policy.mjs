import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Reviewed package names, not a live dependency traversal: new dependencies require review.
export const allowedPackages = JSON.parse(readFileSync(new URL('./bundle-allowlist.json', import.meta.url), 'utf8'));
export const forbiddenPatterns = [
    '**/node_modules/@anthropic-ai/claude-agent-sdk{,-*}{,/**/*}',
    '**/node_modules/@cursor/sdk{,-*}{,/**/*}',
    '**/node_modules/@github/copilot{,-*}{,/**/*}',
    '**/node_modules/@paperclipai/server/provider-assets/copilot{,/**/*}',
];
export function forbiddenPath(path) {
    return /(?:^|\/)node_modules\/(?:@anthropic-ai\/claude-agent-sdk(?:-[^/]+)?|@cursor\/sdk(?:-[^/]+)?|@github\/copilot(?:-[^/]+)?)(?:\/|$)/.test(path.replaceAll('\\', '/')) || /(?:^|\/)node_modules\/@paperclipai\/server\/provider-assets\/copilot(?:\/|$)/.test(path.replaceAll('\\', '/'));
}
const scopes = [...new Set(allowedPackages.filter(n => n.startsWith('@')).map(n => n.split('/')[0]))];
const top = [...allowedPackages.filter(n => !n.startsWith('@')), ...scopes];
export const dependencyExclusions = [
    `!**/node_modules/!(${top.join('|')})/**/*`,
    ...scopes.map(scope => `!**/node_modules/${scope}/!(${allowedPackages.filter(n => n.startsWith(scope + '/')).map(n => n.split('/')[1]).join('|')})/**/*`),
    ...forbiddenPatterns.map(p => '!' + p),
];
export const files = ['dist/**/*', 'assets/**/*', 'package.json', 'THIRD_PARTY_NOTICES.md', 'src/runner/**/*', 'build/icons/512x512.png', ...dependencyExclusions];
// Paperclip runs under standalone Node, so its JS dependency closure also needs real paths.
export const asarUnpack = [...allowedPackages.map(n => `**/node_modules/${n}/**/*`), ...dependencyExclusions, 'src/runner/**/*'];
export function assertConfig(config) {
    for (const [key, expected] of Object.entries({ files, asarUnpack, afterPack: 'scripts/bundle-after-pack.mjs' })) {
        if (JSON.stringify(config[key]) !== JSON.stringify(expected))
            throw new Error(`build.${key} differs from bundle-license-policy.mjs; run node scripts/bundle-license-policy.mjs --write`);
    }
    if (allowedPackages.some(n => forbiddenPath('node_modules/' + n)))
        throw new Error('Forbidden package in bundle allowlist');
}
export function walkFiles(root, visit, prefix = '') {
    for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        visit(path);
        if (entry.isDirectory()) walkFiles(root, visit, path);
    }
}
// Reused directly by unit tests (no child process or installer required).
export async function checkInstalledTree(root = 'node_modules') {
    const { getNodeModuleFileMatcher } = await import('app-builder-lib/out/fileMatcher.js');
    const matcher = getNodeModuleFileMatcher(resolve('.'), '/unused-output', p => p, {}, { config: { files }, debugLogger: { isEnabled: false } });
    const include = matcher.createFilter();
    let checked = 0;
    walkFiles(root, path => {
        const full = 'node_modules/' + path;
        if (forbiddenPath(full)) {
            checked++;
            if (include(resolve(full), { isDirectory: () => false, moduleFullFilePath: full }))
                throw new Error(`Forbidden bundle path: ${full}`);
        }
    });
    return checked;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    if (process.argv.includes('--write')) {
        Object.assign(pkg.build, { files, asarUnpack, afterPack: 'scripts/bundle-after-pack.mjs' });
        writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
    } else {
        assertConfig(pkg.build);
        const checked = await checkInstalledTree();
        console.log(`Bundle policy OK (${checked} restricted paths checked; no installer generated)`);
    }
}
