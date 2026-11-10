import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

export const optionalPackages = {
    claude: '@anthropic-ai/claude-agent-sdk',
    cursor: '@cursor/sdk',
    cursorCloud: '@paperclipai/adapter-cursor-cloud/server',
    copilot: '@github/copilot',
} as const;
type Loader = (name: string) => Promise<unknown>;
export type OptionalAdapter = { available: true; module: unknown } | { available: false; message: string };
async function loadPackage(name: string) {
    // Optional operator installation takes precedence over the application dependency tree.
    const require = createRequire(process.env.KEEPMIND_OPTIONAL_PACKAGES_DIR
        ? join(process.env.KEEPMIND_OPTIONAL_PACKAGES_DIR, 'package.json') : import.meta.url);
    return import(pathToFileURL(require.resolve(name)).href);
}
export async function loadOptionalAdapter(feature: keyof typeof optionalPackages, load: Loader = loadPackage): Promise<OptionalAdapter> {
    const name = optionalPackages[feature];
    try {
        return { available: true, module: await load(name) };
    }
    catch {
        return { available: false, message: `${feature} is unavailable until you install ${name.split('/server')[0]} yourself under its upstream terms. Set KEEPMIND_OPTIONAL_PACKAGES_DIR to that installation directory.` };
    }
}
export async function optionalAdapterStatus(load: Loader = loadPackage) {
    return Object.fromEntries(await Promise.all(Object.keys(optionalPackages).map(async feature => {
        const result = await loadOptionalAdapter(feature as keyof typeof optionalPackages, load);
        return [feature, result.available ? { available: true } : result];
    })));
}
