import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';

export type InstallProduct = 'personal' | 'corporate';
export type InstallPlatform = 'darwin' | 'win32' | 'linux';

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  digest?: string | null;
}
export interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: ReleaseAsset[];
}

const REPO = 'criptogus/keepmind';
const API = `https://api.github.com/repos/${REPO}/releases?per_page=30`;

// Personal = the KeepMind app releases (v* tags). Corporate = corp-v* tags.
const PERSONAL_ASSET: Record<InstallPlatform, RegExp> = {
  darwin: /^KeepMind-\d+\.\d+\.\d+[\w.-]*-universal\.dmg$/i,
  win32: /^KeepMind\.Setup\.\d+\.\d+\.\d+.*\.exe$/i,
  linux: /^KeepMind-\d+\.\d+\.\d+[\w.-]*\.AppImage$/i,
};
// Corp artifacts are named after productName "KeepMind Corp" and may contain
// spaces; accept any corp-tagged release asset matching the platform shape.
const CORPORATE_ASSET: Record<InstallPlatform, RegExp> = {
  darwin: /corp.*\.dmg$/i,
  win32: /corp.*\.exe$/i,
  linux: /corp.*AppImage/i,
};

export function pickRelease(
  releases: GitHubRelease[],
  product: InstallProduct,
): GitHubRelease | null {
  const usable = releases.filter((r) => !r.draft);
  const sorted = [...usable].sort(
    (a, b) => Date.parse(b.published_at ?? '0') - Date.parse(a.published_at ?? '0'),
  );
  if (product === 'corporate') {
    return sorted.find((r) => /^corp-v/i.test(r.tag_name)) ?? null;
  }
  return sorted.find((r) => !r.prerelease && !/^corp-v/i.test(r.tag_name)) ?? null;
}

export function pickAsset(
  release: GitHubRelease | null,
  product: InstallProduct,
  platform: InstallPlatform,
): ReleaseAsset | null {
  if (!release) return null;
  const re = product === 'corporate' ? CORPORATE_ASSET[platform] : PERSONAL_ASSET[platform];
  return release.assets.find((a) => re.test(a.name) && !/\.blockmap$/i.test(a.name)) ?? null;
}

export async function resolveInstallAsset(
  product: InstallProduct,
  platform: InstallPlatform,
): Promise<{ asset: ReleaseAsset; release: GitHubRelease } | { error: string }> {
  const res = await fetch(API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'keepmind-os' },
  });
  if (!res.ok) return { error: `GitHub API HTTP ${res.status}` };
  const releases = (await res.json()) as GitHubRelease[];
  const release = pickRelease(releases, product);
  if (!release) {
    return {
      error:
        product === 'corporate'
          ? 'No KeepMind Corp release published yet'
          : 'No KeepMind release found',
    };
  }
  const asset = pickAsset(release, product, platform);
  if (!asset) return { error: `No installer for this platform in ${release.tag_name}` };
  return { asset, release };
}

async function sha256File(path: string): Promise<string> {
  const { createReadStream } = await import('node:fs');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export interface InstallResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export async function downloadAndOpenInstaller(
  product: InstallProduct,
  platform: InstallPlatform,
  downloadsDir: string,
  onProgress?: (received: number, total: number) => void,
): Promise<InstallResult> {
  const resolved = await resolveInstallAsset(product, platform);
  if ('error' in resolved) return { ok: false, error: resolved.error };
  const { asset } = resolved;

  const res = await fetch(asset.browser_download_url, {
    headers: { 'User-Agent': 'keepmind-os' },
  });
  if (!res.ok || !res.body) return { ok: false, error: `Download failed (HTTP ${res.status})` };

  const safeName = asset.name.replace(/[^\w. ()-]/g, '_');
  const dest = join(downloadsDir, safeName);
  await mkdir(downloadsDir, { recursive: true });

  const total = Number(res.headers.get('content-length') ?? 0);
  let received = 0;
  const counter = new Readable({
    read() {},
  });
  void (async () => {
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        counter.push(Buffer.from(value));
        onProgress?.(received, total);
      }
      counter.push(null);
    } catch (e) {
      counter.destroy(e instanceof Error ? e : new Error(String(e)));
    }
  })();
  await pipeline(counter, createWriteStream(dest));

  // Verify integrity when GitHub exposes a sha256 digest for the asset.
  const expected = asset.digest?.startsWith('sha256:') ? asset.digest.slice(7) : null;
  if (expected) {
    const actual = await sha256File(dest);
    if (actual !== expected) {
      const { rm } = await import('node:fs/promises');
      await rm(dest, { force: true });
      return { ok: false, error: 'Downloaded file failed SHA-256 verification' };
    }
  }
  return { ok: true, path: dest };
}
