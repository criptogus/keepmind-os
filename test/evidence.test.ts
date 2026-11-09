import { it, expect } from 'vitest';
import { sanitizeEvidence } from './integration/evidence';
it('sanitizes credentials in log chunks and comments before truncating', () => {
    const result = sanitizeEvidence({ content: 'agent-secret-long provider-secret Bearer unknown-credential eyJabc.def.ghi', password: 'private-password', apiKey: 'private-key' }, ['agent-secret-long', 'provider-secret']);
    for (const secret of ['agent-secret-long', 'provider-secret', 'unknown-credential', 'eyJabc.def.ghi', 'private-password', 'private-key']) expect(result).not.toContain(secret);
    expect(sanitizeEvidence('xxagent-secret-long', ['agent-secret-long'], 5)).toBe('xx[re');
});

it('ignores short redaction values while preserving status codes, IDs and timestamps', () => {
    const text = '2026-11-09 status 422 run-101 short-value abcdefghijkl';
    expect(sanitizeEvidence(text, ['', '0', '1', 'short-value', 'abcdefghijkl']))
        .toBe('2026-11-09 status 422 run-101 short-value [redacted]');
});
