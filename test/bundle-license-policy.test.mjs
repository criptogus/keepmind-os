import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Minimatch } from 'minimatch';
import { allowedPackages, checkInstalledTree, assertConfig, files, asarUnpack, forbiddenPath } from '../scripts/bundle-license-policy.mjs';
import { guardCursorEntry } from '../scripts/bundle-after-pack.mjs';

const excluded = path => files.filter(p => p.startsWith('!')).some(p => new Minimatch(p.slice(1), { dot: true }).match(path));
describe('bundle license policy', () => {
    it('keeps electron-builder config synchronized and rejects policy drift', () => {
        const { build } = JSON.parse(readFileSync('package.json', 'utf8'));
        expect(() => assertConfig(build)).not.toThrow();
        expect(() => assertConfig({ ...build, asarUnpack: ['node_modules/**/*'] })).toThrow();
        expect(() => assertConfig({ ...build, files: [...files, 'node_modules/@cursor/sdk/**/*'] })).toThrow();
    });
    it('excludes restricted SDKs and vendor content at every nesting depth', () => {
        for (const prefix of ['node_modules/', 'node_modules/@paperclipai/server/node_modules/', 'node_modules/a/node_modules/b/node_modules/']) {
            for (const pkg of ['@anthropic-ai/claude-agent-sdk', '@anthropic-ai/claude-agent-sdk-linux-x64', '@cursor/sdk', '@cursor/sdk-darwin-arm64', '@github/copilot', '@github/copilot-sdk', '@github/copilot-linux-x64', '@paperclipai/server/provider-assets/copilot']) {
                const path = `${prefix}${pkg}/hidden/runtime.node`;
                expect(forbiddenPath(path)).toBe(true);
                expect(excluded(path), path).toBe(true);
                expect(asarUnpack.filter(p => !p.startsWith('!')).some(p => new Minimatch(p).match(path)) && !excluded(path), path).toBe(false);
            }
        }
    });
    it('denies unreviewed packages and permits the process runtime', () => {
        expect(excluded('node_modules/new-unreviewed-sdk/index.js')).toBe(true);
        expect(excluded('node_modules/@paperclipai/server/node_modules/@cursor/unknown/index.js')).toBe(true);
        for (const name of ['paperclipai', '@paperclipai/server', '@embedded-postgres/linux-x64', '@img/sharp-linux-x64', 'sharp']) {
            expect(allowedPackages).toContain(name);
            expect(excluded(`node_modules/${name}/index.js`)).toBe(false);
        }
    });
    it('checks the real installed tree without modifying it or building installers', async () => {
        expect(await checkInstalledTree()).toBeGreaterThan(0);
    });
    it('guards the installed Paperclip entry against eager SDK imports', async () => {
        const source = readFileSync('node_modules/@paperclipai/adapter-cursor-cloud/dist/server/index.js', 'utf8');
        const guarded = guardCursorEntry(source);
        // Resolve the dependency-free codec via a data URL; SDK imports remain deliberately unresolved.
        const module = await import('data:text/javascript,' + encodeURIComponent(guarded.replace('"./session.js"', '"data:text/javascript,export const sessionCodec = {}"').replaceAll("'./execute.js'", "'file:///missing-keepmind-sdk/execute.js'").replaceAll("'./test.js'", "'file:///missing-keepmind-sdk/test.js'")));
        expect(module.getConfigSchema().fields.length).toBeGreaterThan(0);
        expect(await module.execute()).toMatchObject({ available: false });
        expect(await module.testEnvironment()).toMatchObject({ available: false, status: 'fail' });
        expect(() => guardCursorEntry('changed upstream entry')).toThrow();
    });
});
