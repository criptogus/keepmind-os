// Exact string matching deliberately rejects normalization, paths, queries and fragments.
export function isAllowedExternalUrl(url: unknown): url is string {
    return url === 'https://zeroagency.ai' || url === 'https://zeroagency.ai/';
}
export async function openAllowedExternal(url: unknown, open: (url: string) => Promise<void>): Promise<void> {
    if (!isAllowedExternalUrl(url)) throw new Error('External URL is not allowed');
    await open(url);
}
