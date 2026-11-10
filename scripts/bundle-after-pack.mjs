import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { listPackage } from '@electron/asar';
import { assertConfig, forbiddenPath, walkFiles } from './bundle-license-policy.mjs';

export function guardCursorEntry(source) {
    const execute = 'export { execute } from "./execute.js";';
    const test = 'export { testEnvironment } from "./test.js";';
    if (!source.includes(execute) || !source.includes(test))
        throw new Error('Cursor Cloud entry changed; review the optional SDK guard');
    return source.replace(execute, `export async function execute(...args) {
    try { return await (await import('./execute.js')).execute(...args); }
    catch (error) {
        if (error.code !== 'ERR_MODULE_NOT_FOUND' && error.code !== 'MODULE_NOT_FOUND') throw error;
        return { available: false, exitCode: 1, errorMessage: 'Cursor Cloud unavailable until you install @cursor/sdk yourself under its upstream terms.' };
    }
}`).replace(test, `export async function testEnvironment(...args) {
    try { return await (await import('./test.js')).testEnvironment(...args); }
    catch (error) {
        if (error.code !== 'ERR_MODULE_NOT_FOUND' && error.code !== 'MODULE_NOT_FOUND') throw error;
        return { available: false, status: 'fail', checks: [{ code: 'optional_sdk_missing', level: 'error', message: 'Cursor Cloud unavailable until you install @cursor/sdk yourself under its upstream terms.' }] };
    }
}`);
}
export default async function afterPack(context) {
    assertConfig(context.packager.config);
    const resources = context.electronPlatformName === 'darwin'
        ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
        : join(context.appOutDir, 'resources');
    const unpacked = join(resources, 'app.asar.unpacked');
    const entries = [];
    walkFiles(unpacked, path => {
        if (forbiddenPath(path)) throw new Error(`Restricted content staged: ${path}`);
        if (path.endsWith('node_modules/@paperclipai/adapter-cursor-cloud/dist/server/index.js')) entries.push(path);
    });
    if (!entries.length) throw new Error('Cursor Cloud entry missing from staging; review startup guard');
    const stagingRoot = await realpath(unpacked);
    for (const path of entries) {
        const target = await realpath(join(unpacked, path));
        const location = relative(stagingRoot, target);
        if (location.startsWith('..') || isAbsolute(location))
            throw new Error('Refusing to modify an adapter outside the unpacked staging tree');
        await writeFile(target, guardCursorEntry(await readFile(target, 'utf8')));
    }
    for (const path of listPackage(join(resources, 'app.asar'))) {
        if (forbiddenPath(path)) throw new Error(`Restricted content in asar: ${path}`);
    }
}
