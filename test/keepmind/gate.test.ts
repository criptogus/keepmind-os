import { expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clientIdFor, spaceFor, vaultDir, scopesFor, writeScopes, gateCall, authorizeContent, checkedPath } from '../../src/main/keepmind';
it('maps only validated company identities', () => {
    expect(clientIdFor('acme')).toBe('zaos-acme');
    expect(spaceFor('acme')).toBe('company-acme');
    expect(vaultDir('/data', 'acme')).toBe('/data/companies/acme/memory');
    for (const id of ['', '../beta', '/acme', 'a b', 'a'.repeat(65), 'acme\0']) expect(() => clientIdFor(id)).toThrow();
});
it('writes scopes with exactly one client and no write authority', () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'km-scopes-'));
    try {
        const scopes = JSON.parse(readFileSync(writeScopes(root, 'acme'), 'utf8'));
        expect(scopes).toEqual(scopesFor('acme'));
        expect(Object.keys(scopes.clients)).toEqual(['zaos-acme']);
        expect(scopes.clients['zaos-acme']).toEqual({ spaces: ['company-acme'], defaultSpace: 'company-acme', maxClass: 'internal', write: false });
        expect(scopes.clients['zaos-beta']).toBeUndefined();
    } finally { rmSync(root, { recursive: true, force: true }); }
});
it('normalizes aliases and caps search and recency', () => {
    expect(gateCall('search', { query: 'plan', limit: 100 }).args.limit).toBe(8);
    expect(gateCall('sb_recent', { days: 100 }).args.days).toBe(7);
    expect(gateCall('read', { path: 'notes/a.md' }).tool).toBe('sb_read');
    for (const limit of [0, -1, NaN, Infinity, '8', 1.5]) expect(() => gateCall('sb_search', { query: '', limit })).toThrow();
});
it('denies unknown tools, all writes and authority fields', () => {
    for (const tool of ['sb_write', 'sb_append', 'sb_remember', 'sb_supersede', 'sb_tasks', 'sb_tree', 'sb_query', 'learning_list', 'resources/read', 'toString', '__proto__']) expect(() => gateCall(tool, {})).toThrow();
    for (const key of ['companyId', 'clientId', 'space', 'vault', 'vaultPath', 'env']) expect(() => gateCall('search', { query: '', [key]: 'beta' })).toThrow();
});
it('requires explicit company space and public/internal including elevation rules', () => {
    const note = (metadata: string, body = 'Plan') => `---\n${metadata}\n---\n${body}`;
    for (const cls of ['public', 'internal']) expect(authorizeContent(note(`space: company-acme\nclass: ${cls}`), 'acme')).toBe(true);
    for (const meta of ['space: personal\nclass: internal', 'space: company-beta\nclass: internal', 'space: company-acme', 'space: company-acme\nclass: secret', 'space: company-acme\nclass: sensitive', 'space: company-acme\nclass: unknown', 'space: company-acme\nclass: internal\nclass_override: secret', 'space: company-acme\nclass: internal\nclass_override: unknown', 'space: company-acme\nclass: internal\nclass: secret']) expect(authorizeContent(note(meta), 'acme'), meta).toBe(false);
    expect(authorizeContent(note('space: company-acme\nclass: internal', 'test@example.invalid'), 'acme')).toBe(false);
    expect(authorizeContent(note('space: company-acme\nclass: internal', 'sk-fixture-only'), 'acme')).toBe(false);
});
it('denies traversal, platform absolute paths and symlinked roots/ancestors', () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'km-path-'));
    try {
        const vault = join(root, 'vault'); mkdirSync(vault); mkdirSync(join(root, 'outside'));
        symlinkSync(join(root, 'outside'), join(vault, 'escape'));
        symlinkSync(vault, join(root, 'alias'));
        for (const path of ['../bait', '/tmp/bait', 'C:\\bait', '..\\bait', 'notes/../bait', 'a\0b', 'escape/new.md']) expect(() => checkedPath(vault, path), path).toThrow();
        expect(() => checkedPath(join(root, 'alias'), 'new.md')).toThrow();
        expect(checkedPath(vault, 'notes/new.md')).toBe(join(vault, 'notes/new.md'));
    } finally { rmSync(root, { recursive: true, force: true }); }
});
