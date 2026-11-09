import { join } from 'node:path';
export function runtimePaths(appPath: string, packaged: boolean) {
    const external = packaged ? appPath.replace(/app\.asar$/, 'app.asar.unpacked') : appPath;
    return {
        entry: join(external, 'node_modules/paperclipai/dist/index.js'),
        runner: join(external, 'src/runner/zaos-runner.mjs'),
        cwd: external,
        renderer: join(appPath, 'dist/renderer/index.html'),
        preload: join(appPath, 'dist/main/preload.cjs'),
        identity: join(appPath, 'assets/paperclip-identity.css'),
    };
}
