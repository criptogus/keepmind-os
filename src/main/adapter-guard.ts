export function hardenAdapterConfig(type: string, config: Record<string, unknown>) {
    const key = type === 'codex_local' ? 'dangerouslyBypassApprovalsAndSandbox' : type === 'claude_local' ? 'dangerouslySkipPermissions' : undefined;
    if (key) {
        if (config[key] !== undefined && config[key] !== false)
            throw new Error('Dangerous adapter permissions refused');
        return { ...config, [key]: false };
    }
    return { ...config };
}
export function validateAdapter(type: string, config: Record<string, unknown>, runnerPath?: string) {
    hardenAdapterConfig(type, config);
    if (type !== 'process')
        throw new Error('MVP only supports the ZAOS process runner');
    if (!runnerPath || !Array.isArray(config.args) || config.args.length !== 1 || config.args[0] !== runnerPath || typeof config.command !== 'string' || !config.command)
        throw new Error('Only the ZAOS runner is allowed');
    return true;
}
