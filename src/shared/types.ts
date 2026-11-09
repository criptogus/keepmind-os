export type ConnectorId = 'custom' | 'openrouter' | 'deepseek' | 'hermes' | 'codex' | 'claude';
export interface ConnectorModel { id: string; name: string; priceKnown: boolean; inputCentsPerMTok?: number; outputCentsPerMTok?: number; contextLength?: number; maxOutputTokens?: number; pricesRetrievedAt?: string; pricingSource?: string }
export interface ConnectorDetection { installed: boolean; loggedIn: boolean; authMethod?: 'subscription' | 'api-key' | 'unknown' }
export interface ConfigureConnector { connectorId: ConnectorId; mode: 'api' | 'api-key' | 'cli-subscription'; baseUrl?: string; model: string; prices?: { inputCentsPerMTok: number; outputCentsPerMTok: number }; limits: { maxOutputTokens?: number; maxRunCents?: number; monthlyRunCap?: number; cliTimeoutSec?: number } }
export type ConnectorConfig = (ProviderConfig & { connectorId: ConnectorId; mode: 'api'; priceKnown: true; pricingSource?: string; pricesRetrievedAt?: string }) | { connectorId: 'codex' | 'claude'; mode: 'cli-subscription'; model: string; monthlyRunCap: number; cliTimeoutSec: number };
export interface ReviewInteraction {
    id: string;
    kind: string;
    status: string;
    sourceRunId: string | null;
    idempotencyKey?: string | null;
    addresseeUserId?: string | null;
    resolverPolicy?: string;
    continuationPolicy?: string;
    payload?: { detailsMarkdown?: string };
}
export type SupervisorState = 'stopped' | 'starting' | 'ready' | 'unavailable' | 'crashed';
export interface ProviderConfig {
    baseUrl: string;
    model: string;
    inputCentsPerMTok: number;
    outputCentsPerMTok: number;
    maxOutputTokens: number;
    maxRunCents: number;
}
export interface Agent {
    id: string;
    name: string;
    status?: string;
    budgetMonthlyCents: number;
    spentMonthlyCents: number;
}
export interface Issue {
    assigneeUserId?: string | null;
    id: string;
    title: string;
    description?: string;
    status: string;
}
export interface Run {
    id: string;
    issueId?: string;
    status: string;
}
export interface TaskResult {
    issueId?: string;
    result: string;
    costCents: number;
    spent: number;
    cap: number;
    status: string;
}
export interface Encryptor {
    encrypt(value: string): string;
    decrypt(value: string): string;
}
export interface BoardApi {
    request<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
}
export interface ZaosAPI {
    listConnectors(): Promise<{ id: ConnectorId; modes: string[] }[]>;
    detectConnector(id: ConnectorId): Promise<ConnectorDetection>;
    startConnectorLogin(id: ConnectorId): Promise<void>;
    listConnectorModels(id: ConnectorId): Promise<ConnectorModel[]>;
    configureConnector(config: ConfigureConnector): Promise<void>;
    getStatus(): Promise<{
        state: SupervisorState;
        lastError?: string;
        paidExecution: boolean;
        configured?: boolean;
        setupProgress?: number;
        cap?: number;
        logTail?: string;
        lastResult?: TaskResult;
    }>;
    retryStartup(): Promise<void>;
    openBoard(): Promise<void>;
    createCompany(name: string): Promise<{
        id: string;
    }>;
    createAgentFromTemplate(templateId: string, provider: ProviderConfig): Promise<Agent>;
    setProviderKey(key: string): Promise<void>;
    setSpendCap(cap: number): Promise<void>;
    setPaidExecution(enabled: boolean, consent: boolean): Promise<void>;
    runTask(title: string, description: string): Promise<TaskResult>;
    acceptReview(issueId: string): Promise<ReviewInteraction>;
    listRuns(): Promise<Run[]>;
    getTelemetry(): Promise<boolean>;
    setTelemetry(enabled: boolean): Promise<void>;
}
export interface IpcPayloads {
    listConnectors: Record<string, never>;
    detectConnector: { id: ConnectorId };
    startConnectorLogin: { id: ConnectorId };
    listConnectorModels: { id: ConnectorId };
    configureConnector: ConfigureConnector;
    getStatus: Record<string, never>;
    retryStartup: Record<string, never>;
    openBoard: Record<string, never>;
    createCompany: {
        name: string;
    };
    createAgentFromTemplate: {
        templateId: string;
        provider: ProviderConfig;
    };
    setProviderKey: {
        key: string;
    };
    setSpendCap: {
        cap: number;
    };
    setPaidExecution: {
        enabled: boolean;
        consent: boolean;
    };
    runTask: {
        title: string;
        description: string;
    };
    acceptReview: { issueId: string };
    listRuns: Record<string, never>;
    getTelemetry: Record<string, never>;
    setTelemetry: {
        enabled: boolean;
    };
}
