import type { IpcPayloads, ZaosAPI } from '../shared/types';
import { validatePayload, validateSender } from './ipc-validation';
export const channels = ['testConnector', 'listConnectors', 'detectConnector', 'startConnectorLogin', 'listConnectorModels', 'configureConnector', 'getStatus', 'retryStartup', 'openBoard', 'createCompany', 'createAgentFromTemplate', 'setProviderKey', 'setSpendCap', 'setPaidExecution', 'runTask', 'acceptReview', 'listRuns', 'getTelemetry', 'setTelemetry'] as const;
type Event = { sender: unknown; senderFrame: { url: string } | null };
export function registerIpc(ipc: { handle(channel: string, handler: (e: Event, payload: unknown) => unknown): void }, api: ZaosAPI, owned: { url: string; contents: unknown; mainFrame(): unknown }) {
    for (const channel of channels) ipc.handle(`zaos:${channel}`, async (event, value) => {
        if (event.sender !== owned.contents || !validateSender({ url: event.senderFrame?.url ?? '', isMainFrame: event.senderFrame === owned.mainFrame() }, owned.url)) throw new Error('Unauthorized IPC sender');
        const p = validatePayload(channel, value) as unknown as IpcPayloads[typeof channel];
        switch (channel) {
            case 'detectConnector': case 'startConnectorLogin': case 'listConnectorModels': return api[channel]((p as IpcPayloads['detectConnector']).id);
            case 'testConnector': return api.testConnector(p as IpcPayloads['testConnector']);
            case 'configureConnector': return api.configureConnector(p as IpcPayloads['configureConnector']);
            case 'createCompany': return api.createCompany((p as IpcPayloads['createCompany']).name);
            case 'createAgentFromTemplate': { const v = p as IpcPayloads['createAgentFromTemplate']; return api.createAgentFromTemplate(v.templateId, v.provider); }
            case 'setProviderKey': return api.setProviderKey((p as IpcPayloads['setProviderKey']).key);
            case 'setSpendCap': return api.setSpendCap((p as IpcPayloads['setSpendCap']).cap);
            case 'setPaidExecution': { const v = p as IpcPayloads['setPaidExecution']; return api.setPaidExecution(v.enabled, v.consent); }
            case 'runTask': { const v = p as IpcPayloads['runTask']; return api.runTask(v.title, v.description); }
            case 'acceptReview': return api.acceptReview((p as IpcPayloads['acceptReview']).issueId);
            case 'setTelemetry': return api.setTelemetry((p as IpcPayloads['setTelemetry']).enabled);
            default: return api[channel]();
        }
    });
}
