import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:net';
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }));
import { OAuthManager } from '../src/main/auth/OAuthManager';
const active: OAuthManager[] = [];
afterEach(() => { for (const manager of active) (manager as any).cancelAuthentication?.('openai'); active.length = 0; vi.unstubAllEnvs(); });
it('lets a user cancel when the OS accepts opening but no browser callback arrives', async () => {
  const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as {port:number}).port; await new Promise<void>(resolve => probe.close(() => resolve()));
  vi.stubEnv('OPENAI_OAUTH_REDIRECT_URI', `http://127.0.0.1:${port}/auth/callback`);
  const opener = vi.fn(async () => {});
  const manager = new OAuthManager({} as any, undefined, opener); active.push(manager);
  const result = manager.authenticate('openai').catch(error => error.message);
  await vi.waitFor(() => expect(opener).toHaveBeenCalledOnce());
  expect(manager.getAuthUrl('openai')).toMatch(/^https:\/\/auth.openai.com\//);
  try {
    expect(typeof (manager as any).cancelAuthentication).toBe('function');
    (manager as any).cancelAuthentication('openai');
    expect(await result).toBe('Authentication cancelled');
    expect(manager.getAuthUrl('openai')).toBeNull();
    const retry = manager.authenticate('openai').catch(error => error.message);
    await vi.waitFor(() => expect(opener).toHaveBeenCalledTimes(2));
    manager.cancelAuthentication('openai');
    expect(await retry).toBe('Authentication cancelled');
  } finally {
    if (!(manager as any).cancelAuthentication) {
      const url = new URL(manager.getAuthUrl('openai')!);
      await fetch(`http://127.0.0.1:${port}/auth/callback?error=access_denied&state=${url.searchParams.get('state')}`);
      await result;
    }
  }
});
