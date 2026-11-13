import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** Explicit recovery choice: never change the default browser or stop other apps. */
export async function openLoginInSafari(url: string | null | undefined, platform = process.platform, run = promisify(execFile)) {
  if (platform !== 'darwin') throw new Error('Esta alternativa está disponível apenas no macOS.');
  if (!url) throw new Error('O login expirou. Inicie a conexão novamente.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Link de login inválido.');
  try { await run('/usr/bin/open', ['-a', 'Safari', parsed.href], { timeout: 10000 }); }
  catch { throw new Error('Não foi possível abrir o Safari. Copie o link e abra no navegador.'); }
}
