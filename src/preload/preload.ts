import { contextBridge, ipcRenderer } from 'electron';
import type { ZaosAPI } from '../shared/types';
const invoke = (channel: string, payload: unknown = {}) => ipcRenderer.invoke(`zaos:${channel}`, payload);
const api: ZaosAPI = {
    getStatus: () => invoke('getStatus'), retryStartup: () => invoke('retryStartup'), openBoard: () => invoke('openBoard'),
    createCompany: name => invoke('createCompany', { name }),
    createAgentFromTemplate: (templateId, provider) => invoke('createAgentFromTemplate', { templateId, provider }),
    setProviderKey: key => invoke('setProviderKey', { key }), setSpendCap: cap => invoke('setSpendCap', { cap }),
    setPaidExecution: (enabled, consent) => invoke('setPaidExecution', { enabled, consent }),
    runTask: (title, description) => invoke('runTask', { title, description }), acceptReview: issueId => invoke('acceptReview', { issueId }),
    listRuns: () => invoke('listRuns'), getTelemetry: () => invoke('getTelemetry'), setTelemetry: enabled => invoke('setTelemetry', { enabled }),
};
contextBridge.exposeInMainWorld('zaos', Object.freeze(api));
