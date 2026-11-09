// Redact before truncation so a boundary cannot expose a partial credential.
export function sanitizeEvidence(value: unknown, secrets: string[] = [], limit = 16000): string {
    let text = typeof value === 'string' ? value : JSON.stringify(value);
    for (const secret of secrets.filter(secret => secret.length >= 12).sort((a, b) => b.length - a.length))
        text = text.split(secret).join('[redacted]');
    text = text.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]')
        .replace(/\b(?:pcp_|sk-)[A-Za-z0-9_-]+/g, '[redacted]')
        .replace(/(bearer\s+)[^\s"\\]+/gi, '$1[redacted]')
        .replace(/((?:["']?(?:[\w-]*(?:key|token|secret|password)|cookie|authorization)["']?)\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s,;}]+)/gi, '$1"[redacted]"');
    return text.slice(0, limit);
}
