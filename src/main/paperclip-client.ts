import type { BoardApi } from '../shared/types';
export class PaperclipClient implements BoardApi {
    private cookie = '';
    constructor(readonly baseUrl: string, private fetcher: typeof fetch = fetch) {
        const u = new URL(baseUrl);
        if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || u.username || u.password || u.pathname !== '/')
            throw new Error('Paperclip must use HTTP on 127.0.0.1');
    }
    async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
        if (!path.startsWith('/api/') || path.includes('..'))
            throw new Error('Invalid API path');
        const res = await this.fetcher(new URL(path, this.baseUrl), { method, headers: { Origin: this.baseUrl, 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000), redirect: 'error' });
        const cookies = res.headers.getSetCookie?.() ?? [];
        if (cookies.length)
            this.cookie = cookies.map(c => c.split(';')[0]).join('; ');
        if (!res.ok)
            throw new Error(`Paperclip request failed (${res.status})`);
        return (res.status === 204 ? undefined : await res.json()) as T;
    }
}
