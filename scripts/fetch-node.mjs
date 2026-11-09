import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile, mkdtemp, mkdir, copyFile, chmod, rm, rename, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { platform: { type: 'string' }, arch: { type: 'string' } } });
const platform = values.platform ?? process.env.npm_config_platform ?? process.env.NODE_PLATFORM ?? process.platform;
const arch = values.arch ?? process.env.npm_config_arch ?? process.env.NODE_ARCH ?? process.arch;
if (!['darwin', 'win32', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) {
  throw new Error(`Unsupported Node target: ${platform}-${arch}`);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(new URL('./node-runtime.json', import.meta.url), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid Node version pin');
const os = { darwin: 'mac', win32: 'win', linux: 'linux' }[platform];
const extension = { darwin: 'tar.gz', win32: 'zip', linux: 'tar.xz' }[platform];
const folder = `node-v${version}-${platform === 'win32' ? 'win' : platform}-${arch}`;
const archive = `${folder}.${extension}`;
const source = `https://nodejs.org/dist/v${version}/${archive}`;
const destination = join(root, 'build', 'node', `${os}-${arch}`);
const binary = platform === 'win32' ? 'node.exe' : 'bin/node';
try {
  const cached = JSON.parse(await readFile(join(destination, 'VERSION.json'), 'utf8'));
  if (cached.version === version && cached.archive === archive && cached.source === source && /^[a-f0-9]{64}$/.test(cached.sha256)) {
    await access(join(destination, binary));
    await access(join(destination, 'LICENSE'));
    console.log(`Node ${version} already staged for ${os}-${arch}`);
    process.exit(0);
  }
} catch (error) {
  if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
}
async function download(url) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`);
  return response;
}
const temp = await mkdtemp(join(tmpdir(), 'keepmind-node-'));
let staging;
try {
  const sums = await (await download(`https://nodejs.org/dist/v${version}/SHASUMS256.txt`)).text();
  const matches = sums.split(/\r?\n/).map(line => /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line)).filter(match => match?.[2] === archive);
  if (matches.length !== 1) throw new Error(`Missing or ambiguous checksum for ${archive}`);
  const sha256 = matches[0][1].toLowerCase();
  const hash = createHash('sha256');
  const archivePath = join(temp, archive);
  await pipeline(Readable.fromWeb((await download(source)).body), new Transform({
    transform(chunk, encoding, callback) { hash.update(chunk); callback(null, chunk); },
  }), createWriteStream(archivePath));
  if (hash.digest('hex') !== sha256) throw new Error(`SHA256 mismatch for ${archive}`);
  execFileSync('tar', [platform === 'linux' ? '-xJf' : platform === 'darwin' ? '-xzf' : '-xf', archivePath, '-C', temp], { stdio: 'inherit' });
  await mkdir(dirname(destination), { recursive: true });
  staging = await mkdtemp(join(dirname(destination), '.staging-'));
  await mkdir(dirname(join(staging, binary)), { recursive: true });
  await copyFile(join(temp, folder, binary), join(staging, binary));
  if (platform !== 'win32') await chmod(join(staging, binary), 0o755);
  await copyFile(join(temp, folder, 'LICENSE'), join(staging, 'LICENSE'));
  await writeFile(join(staging, 'VERSION.json'), JSON.stringify({ version, sha256, archive, source }, null, 2) + '\n');
  await rm(destination, { recursive: true, force: true });
  await rename(staging, destination);
  console.log(`Staged Node ${version} for ${os}-${arch}`);
} finally {
  await rm(temp, { recursive: true, force: true });
  if (staging) await rm(staging, { recursive: true, force: true });
}
