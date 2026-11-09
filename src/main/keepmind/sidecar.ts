import type { WorkspaceState } from '../orchestrator';
import { KeepMindService } from './service';
import { StdioKeepMindTransport, type StdioOptions } from './transport';
/** Main-process launcher only. LLM/agent code never receives scopes paths or unlock material.
 * Each company has its own memory directory. Plaintext is opt-in for synthetic fixtures only.
 * Encrypted unlock FD/keychain lifecycle is a P1 launcher integration; no ambient keys inherited.
 */
export function createCompanyKeepMind(dataRoot: string, workspace: Pick<WorkspaceState, 'companyId'>, options: Pick<StdioOptions, 'entry' | 'node' | 'keepmindPackageRoot' | 'allowPlaintextFixtures'> = {}) {
    if (!workspace.companyId) throw new Error('Workspace company required');
    return new KeepMindService({ dataRoot, companyId: workspace.companyId, transportFactory: context => new StdioKeepMindTransport({ ...options, ...context }) });
}
