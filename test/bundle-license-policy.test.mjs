import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkLock, checkStagedPaths, assertConfig, forbiddenPath } from '../scripts/bundle-license-policy.mjs';
describe('bundle policy', () => {
  it('validates a nonempty pinned production inventory and config', () => {
    expect(checkLock(JSON.parse(readFileSync('package-lock.json', 'utf8')))).toBeGreaterThan(100);
    assertConfig(JSON.parse(readFileSync('package.json', 'utf8')).build);
  });
  it('rejects empty scans, dependency drift, restricted SDK variants and unreviewed staging', () => {
    expect(() => checkLock({ packages: {} })).toThrow('No production');
    expect(() => checkLock({ packages: { 'node_modules/new': { version: '1', license: 'MIT' } } })).toThrow('Unreviewed');
    for (const name of ['@cursor/sdk', '@github/copilot', '@anthropic-ai/claude-agent-sdk-darwin']) {
      expect(forbiddenPath(`node_modules/${name}/index.js`)).toBe(true);
      expect(() => checkStagedPaths([`/node_modules/${name}/index.js`])).toThrow('Restricted');
    }
    expect(() => checkStagedPaths([])).toThrow('No bundled');
    expect(() => checkStagedPaths(['/node_modules/unknown/index.js'])).toThrow('Unreviewed');
    expect(checkStagedPaths(['/node_modules/openai/index.js'])).toBe(1);
  });
});
