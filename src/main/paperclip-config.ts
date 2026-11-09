import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { excludedPorts } from './ports';
export function createConfig(home: string, port: number, pgPort: number, disableSignUp = false) {
    if ([port, pgPort].some(p => !Number.isInteger(p) || p < 1 || p > 65535 || excludedPorts.has(p)) || port === pgPort)
        throw new Error('Distinct available loopback ports are required');
    const root = join(home, 'instances/default');
    return { $meta: { version: 1, updatedAt: new Date().toISOString(), source: 'onboard' }, database: { mode: 'embedded-postgres', embeddedPostgresDataDir: join(root, 'db'), embeddedPostgresPort: pgPort, backup: { enabled: true, intervalMinutes: 60, retentionDays: 30, dir: join(root, 'data/backups') } }, logging: { mode: 'file', logDir: join(root, 'logs') }, server: { deploymentMode: 'authenticated', exposure: 'private', bind: 'loopback', host: '127.0.0.1', port, allowedHostnames: [], serveUi: true }, telemetry: { enabled: false }, updates: { checkEnabled: false }, auth: { baseUrlMode: 'auto', disableSignUp }, storage: { provider: 'local_disk', localDisk: { baseDir: join(root, 'data/storage') }, s3: { bucket: 'paperclip', region: 'us-east-1', prefix: '', forcePathStyle: false } }, secrets: { provider: 'local_encrypted', strictMode: false, localEncrypted: { keyFilePath: join(root, 'secrets/master.key') } } };
}
export async function writeConfig(home: string, config: ReturnType<typeof createConfig>) {
    const dir = join(home, 'instances/default');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(join(dir, 'config.json'), JSON.stringify(config, null, 2), { mode: 0o600 });
}
