import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clientIdFor, spaceFor } from './map';
export function scopesFor(companyId: string) {
    return { clients: { [clientIdFor(companyId)]: { spaces: [spaceFor(companyId)], defaultSpace: spaceFor(companyId), maxClass: 'internal', write: false } } };
}
export function writeScopes(dataRoot: string, companyId: string): string {
    const dir = join(dataRoot, 'keepmind', clientIdFor(companyId));
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, 'scopes.json');
    writeFileSync(path, JSON.stringify(scopesFor(companyId)), { mode: 0o600 });
    return path;
}
