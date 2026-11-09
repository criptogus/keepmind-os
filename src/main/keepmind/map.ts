import { join } from 'node:path';
export function safeCompanyId(companyId: string): string {
    if (typeof companyId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(companyId)) throw new Error('Invalid company ID');
    return companyId;
}
export const clientIdFor = (companyId: string) => `zaos-${safeCompanyId(companyId)}`;
export const spaceFor = (companyId: string) => `company-${safeCompanyId(companyId)}`;
export const vaultDir = (root: string, companyId: string) => join(root, 'companies', safeCompanyId(companyId), 'memory');
