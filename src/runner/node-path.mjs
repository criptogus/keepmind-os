// Preserve all existing environment entries; Windows PATH keys are case insensitive.
export function withNodePath(env, nodeDir, platform = process.platform) {
    if (!nodeDir) return env;
    const key = platform === 'win32' ? Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH' : 'PATH';
    return { ...env, [key]: nodeDir + (env[key] ? (platform === 'win32' ? ';' : ':') + env[key] : '') };
}
