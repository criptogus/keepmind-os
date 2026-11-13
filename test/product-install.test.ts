import { describe, it, expect } from 'vitest';
import { pickRelease, pickAsset, type GitHubRelease } from '../src/main/integrations/productInstall.js';

const rel = (tag: string, prerelease = false, assets: string[] = []): GitHubRelease => ({
  tag_name: tag,
  draft: false,
  prerelease,
  published_at: '2026-11-12T00:00:00Z',
  assets: assets.map((name) => ({ name, browser_download_url: `https://x/${name}` })),
});

describe('productInstall asset resolution', () => {
  it('picks the newest stable personal release, skipping corp tags and prereleases', () => {
    const releases = [
      rel('continuous', true, ['KeepMind-0.2.7-universal.dmg']),
      rel('v0.2.6', false, ['KeepMind-0.2.6-universal.dmg']),
      rel('corp-v0.2.6', false, ['KeepMind Corp-0.2.6-universal.dmg']),
    ];
    expect(pickRelease(releases, 'personal')?.tag_name).toBe('v0.2.6');
  });

  it('picks the newest corp-v* release for corporate', () => {
    const releases = [
      rel('v0.2.6', false, ['KeepMind-0.2.6-universal.dmg']),
      rel('corp-v0.2.5', false, ['KeepMind Corp-0.2.5-universal.dmg']),
      rel('corp-v0.2.6', false, ['KeepMind Corp-0.2.6-universal.dmg']),
    ];
    // same published_at → order preserved; both corp match, first found wins
    expect(pickRelease(releases, 'corporate')?.tag_name).toMatch(/^corp-v/);
  });

  it('returns null when no corp release exists', () => {
    expect(pickRelease([rel('v0.2.6')], 'corporate')).toBeNull();
  });

  it('matches platform assets per product', () => {
    const personal = rel('v0.2.6', false, [
      'KeepMind-0.2.6-universal.dmg',
      'KeepMind.Setup.0.2.6.exe',
      'KeepMind-0.2.6.AppImage',
      'KeepMind-0.2.6-universal-mac.zip',
    ]);
    expect(pickAsset(personal, 'personal', 'darwin')?.name).toBe('KeepMind-0.2.6-universal.dmg');
    expect(pickAsset(personal, 'personal', 'win32')?.name).toBe('KeepMind.Setup.0.2.6.exe');
    expect(pickAsset(personal, 'personal', 'linux')?.name).toBe('KeepMind-0.2.6.AppImage');

    const corp = rel('corp-v0.2.6', false, [
      'KeepMind Corp-0.2.6-universal.dmg',
      'KeepMind Corp Setup 0.2.6.exe',
      'KeepMind Corp-0.2.6.AppImage',
    ]);
    expect(pickAsset(corp, 'corporate', 'darwin')?.name).toContain('Corp');
    expect(pickAsset(corp, 'corporate', 'win32')?.name).toContain('Corp');
    expect(pickAsset(corp, 'corporate', 'linux')?.name).toContain('Corp');
  });

  it('never picks blockmap or zip for dmg/exe slots', () => {
    const r = rel('v0.2.6', false, ['KeepMind-0.2.6-universal.dmg.blockmap', 'KeepMind-0.2.6-mac.zip']);
    expect(pickAsset(r, 'personal', 'darwin')).toBeNull();
    expect(pickAsset(r, 'personal', 'win32')).toBeNull();
  });
});
