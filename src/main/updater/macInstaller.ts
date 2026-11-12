import { app } from 'electron';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function updaterPendingDir(): string | null {
  const caches = path.join(app.getPath('home'), 'Library', 'Caches');
  try {
    const yml = readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
    const name = yml.match(/updaterCacheDirName:\s*(\S+)/)?.[1];
    if (name) {
      const dir = path.join(caches, name, 'pending');
      if (existsSync(dir)) return dir;
    }
  } catch { /* fall through to scan */ }
  try {
    for (const entry of readdirSync(caches)) {
      if (!entry.endsWith('-updater')) continue;
      const dir = path.join(caches, entry, 'pending');
      if (existsSync(dir)) return dir;
    }
  } catch { /* no caches dir */ }
  return null;
}

function sha512Base64(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512');
    const stream = createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('base64')));
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface MacInstallResult {
  ok: boolean;
  error?: string;
}

// Squirrel.Mac refuses to update unsigned/ad-hoc apps because the designated
// requirement is the cdhash, which changes every build. This path performs the
// same job manually: verify the downloaded zip, extract it, then hand a small
// script to a detached shell that waits for this process to exit, swaps the
// .app bundle and relaunches it.
export async function installDownloadedMacUpdate(): Promise<MacInstallResult> {
  if (!app.isPackaged || process.platform !== 'darwin') {
    return { ok: false, error: 'Manual update install is only available in the packaged macOS app' };
  }

  const pending = updaterPendingDir();
  if (!pending) return { ok: false, error: 'Updater cache not found' };

  let fileName: string;
  let expectedSha512: string;
  try {
    const info = JSON.parse(readFileSync(path.join(pending, 'update-info.json'), 'utf8')) as {
      fileName?: string;
      sha512?: string;
    };
    if (!info.fileName || !info.sha512) return { ok: false, error: 'No downloaded update found — download first' };
    fileName = info.fileName;
    expectedSha512 = info.sha512;
  } catch {
    return { ok: false, error: 'No downloaded update found — download first' };
  }

  const zipPath = path.join(pending, fileName);
  if (!existsSync(zipPath)) return { ok: false, error: `Downloaded update missing: ${fileName}` };

  const actualSha512 = await sha512Base64(zipPath);
  if (actualSha512 !== expectedSha512) {
    return { ok: false, error: 'Downloaded update failed integrity check (sha512 mismatch)' };
  }

  const appPath = path.resolve(path.dirname(process.execPath), '..', '..');
  if (!appPath.endsWith('.app') || !existsSync(appPath)) {
    return { ok: false, error: `Cannot locate app bundle at ${appPath}` };
  }
  try {
    execFileSync('test', ['-w', path.dirname(appPath)]);
  } catch {
    return { ok: false, error: `No write permission for ${path.dirname(appPath)} — move the app somewhere writable or reinstall manually` };
  }

  const staging = mkdtempSync(path.join(tmpdir(), 'keepmind-update-'));
  try {
    execFileSync('ditto', ['-x', '-k', zipPath, staging], { stdio: 'pipe' });
    const apps = readdirSync(staging).filter((e) => e.endsWith('.app'));
    if (apps.length !== 1) return { ok: false, error: `Expected exactly one .app in update archive, found ${apps.length}` };
    const stagedApp = path.join(staging, apps[0]);

    try {
      execFileSync('codesign', ['--verify', '--deep', '--strict', stagedApp], { stdio: 'pipe' });
    } catch {
      return { ok: false, error: 'Update app failed code signature verification' };
    }

    // The script must live outside the staging dir: the script deletes staging
    // (including itself) once the app bundle has been moved out.
    const scriptDir = mkdtempSync(path.join(tmpdir(), 'keepmind-swap-'));
    const scriptPath = path.join(scriptDir, 'swap.sh');
    writeFileSync(scriptPath, [
      '#!/bin/bash',
      'set -u',
      `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done`,
      'sleep 1',
      `rm -rf ${shellQuote(appPath)}`,
      `mv ${shellQuote(stagedApp)} ${shellQuote(appPath)}`,
      `rm -rf ${shellQuote(staging)}`,
      `rm -rf ${shellQuote(scriptDir)}`,
      `open ${shellQuote(appPath)}`,
      '',
    ].join('\n'), { mode: 0o755 });

    spawn('bash', [scriptPath], { detached: true, stdio: 'ignore' }).unref();
    app.quit();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function describePendingUpdate(): { fileName: string; sizeBytes: number } | null {
  const pending = updaterPendingDir();
  if (!pending) return null;
  try {
    const info = JSON.parse(readFileSync(path.join(pending, 'update-info.json'), 'utf8')) as { fileName?: string };
    if (!info.fileName) return null;
    const full = path.join(pending, info.fileName);
    return existsSync(full) ? { fileName: info.fileName, sizeBytes: statSync(full).size } : null;
  } catch {
    return null;
  }
}
