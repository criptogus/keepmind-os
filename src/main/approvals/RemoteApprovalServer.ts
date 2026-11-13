import { createServer, type Server } from 'node:http';
import { networkInterfaces } from 'node:os';
import type { Approval } from '../../shared/types.js';

export interface RemoteApprovalDeps {
  getPendingApprovals(): Approval[];
  /** Applies an approve/reject decision (same effect as the desktop queue). */
  decide(id: string, approve: boolean, reason?: string): void;
  /** Unguessable token embedded in every URL — the only auth. */
  getToken(): string;
}

/**
 * Minimal LAN companion for the human-approval queue. Bound to all
 * interfaces on an ephemeral port; every route requires the token in the
 * path. Exposes ONLY pending approvals and their decisions — no other data.
 */
export class RemoteApprovalServer {
  private server: Server | null = null;
  private port = 0;

  constructor(private deps: RemoteApprovalDeps) {}

  get running(): boolean {
    return this.server !== null;
  }

  get url(): string | null {
    if (!this.server) return null;
    const ip = lanIPv4();
    return ip ? `http://${ip}:${this.port}/a/${this.deps.getToken()}` : null;
  }

  async start(preferredPort = 0): Promise<number> {
    if (this.server) return this.port;
    this.server = createServer((req, res) => this.route(req, res));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', error => { this.stop(); reject(error); });
      this.server!.listen(preferredPort, '0.0.0.0', () => resolve());
    });
    const addr = this.server.address();
    this.port = typeof addr === 'object' && addr ? addr.port : preferredPort;
    return this.port;
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    this.port = 0;
  }

  private route(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): void {
    const send = (code: number, body: string, type = 'application/json') => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
      res.end(body);
    };
    const url = new URL(req.url ?? '/', 'http://localhost');
    const m = url.pathname.match(/^\/a\/([a-f0-9]{16,64})(\/.*)?$/);
    if (!m || m[1] !== this.deps.getToken()) {
      send(404, '{"ok":false}');
      return;
    }
    const sub = m[2] ?? '/';

    if (req.method === 'GET' && (sub === '/' || sub === '')) {
      send(200, PAGE_HTML(this.deps.getToken(), this.port), 'text/html; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && sub === '/api') {
      send(200, JSON.stringify({ ok: true, approvals: this.deps.getPendingApprovals() }));
      return;
    }
    if (req.method === 'POST' && sub === '/decide') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 64 * 1024) req.destroy(); });
      req.on('end', () => {
        try {
          const { id, approve, reason } = JSON.parse(body || '{}');
          if (typeof id !== 'string' || typeof approve !== 'boolean') {
            send(400, '{"ok":false,"error":"bad request"}');
            return;
          }
          this.deps.decide(id, approve, typeof reason === 'string' ? reason.slice(0, 500) : undefined);
          send(200, '{"ok":true}');
        } catch {
          send(400, '{"ok":false,"error":"bad json"}');
        }
      });
      return;
    }
    send(404, '{"ok":false}');
  }
}

function lanIPv4(): string | null {
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return null;
}

/** Self-contained approvals page — no external assets, mobile-friendly. */
function PAGE_HTML(token: string, _port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KeepMind OS — Approvals</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', sans-serif; margin: 0; background: #f6f6f4; color: #16161a; }
  header { padding: 16px 20px; background: #16161a; color: #fff; display: flex; justify-content: space-between; align-items: center; }
  header h1 { font-size: 17px; margin: 0; font-weight: 600; }
  header .dot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; display: inline-block; margin-right: 6px; }
  main { padding: 16px; max-width: 720px; margin: 0 auto; }
  .card { background: #fff; border: 1px solid #e5e5e0; border-radius: 12px; padding: 16px; margin-bottom: 12px; }
  .card .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
  .agent { font-weight: 600; font-size: 15px; }
  .time { color: #888; font-size: 12px; white-space: nowrap; }
  .action { font-family: ui-monospace, Menlo, monospace; font-size: 12px; background: #f0f0ec; border-radius: 6px; padding: 6px 8px; margin: 10px 0; word-break: break-all; }
  .args { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: #555; white-space: pre-wrap; word-break: break-word; background: #fafaf8; border-radius: 6px; padding: 8px; max-height: 140px; overflow: auto; }
  .btns { display: flex; gap: 8px; margin-top: 12px; }
  button { flex: 1; padding: 12px; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; }
  .ok { background: #16161a; color: #fff; }
  .no { background: #fff; color: #16161a; border: 1px solid #d4d4cf; }
  .empty { text-align: center; color: #888; padding: 48px 0; }
  .err { color: #b91c1c; font-size: 13px; }
</style>
</head>
<body>
<header><h1><span class="dot"></span>KeepMind OS — Approvals</h1><span id="count"></span></header>
<main id="list"><div class="empty">Loading…</div></main>
<script>
const TOKEN = ${JSON.stringify(token)};
const BASE = '/a/' + TOKEN;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function load() {
  try {
    const r = await fetch(BASE + '/api', { cache: 'no-store' });
    const d = await r.json();
    const list = document.getElementById('list');
    document.getElementById('count').textContent = d.approvals.length ? d.approvals.length + ' pending' : '';
    if (!d.approvals.length) { list.innerHTML = '<div class="empty">No pending approvals 🎉</div>'; return; }
    list.innerHTML = '';
    for (const a of d.approvals) {
      const card = document.createElement('div');
      card.className = 'card';
      const ctx = a.context || {};
      card.innerHTML =
        '<div class="top"><div class="agent"></div><div class="time"></div></div>' +
        '<div class="action"></div>' +
        (ctx.args !== undefined ? '<div class="args"></div>' : '') +
        '<div class="btns"><button class="ok">Approve</button><button class="no">Reject</button></div>' +
        '<div class="err"></div>';
      card.querySelector('.agent').textContent = a.agentName || 'Agent';
      card.querySelector('.time').textContent = new Date(a.createdAt).toLocaleString();
      card.querySelector('.action').textContent = a.action || '';
      if (ctx.args !== undefined) card.querySelector('.args').textContent = JSON.stringify(ctx.args, null, 2);
      card.querySelector('.ok').onclick = () => decide(card, a.id, true);
      card.querySelector('.no').onclick = () => decide(card, a.id, false);
      list.appendChild(card);
    }
  } catch (e) {
    document.getElementById('list').innerHTML = '<div class="empty err">Cannot reach KeepMind OS</div>';
  }
}
async function decide(card, id, approve) {
  const err = card.querySelector('.err');
  err.textContent = '';
  try {
    const r = await fetch(BASE + '/decide', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, approve }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'failed');
    card.remove();
    load();
  } catch (e) { err.textContent = String(e.message || e); }
}
load();
setInterval(load, 5000);
</script>
</body>
</html>`;
}
