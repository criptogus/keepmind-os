import { create } from 'zustand';
import type { Agent, AgentConfig, CreateAgentInput, AgentExecution } from '../../shared/types.js';

interface AgentStore {
  agents: Agent[];
  selectedAgent: Agent | null;
  executions: AgentExecution[];
  loading: boolean;
  error: string | null;

  fetchAgents: () => Promise<void>;
  selectAgent: (id: string) => void;
  createAgent: (input: CreateAgentInput) => Promise<Agent>;
  updateAgent: (id: string, updates: Partial<AgentConfig> & { avatar?: string | null }) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  executeAgent: (id: string, input: Record<string, unknown>) => Promise<void>;
  fetchExecutions: (agentId?: string) => Promise<void>;
  cancelExecution: (executionId: string) => Promise<void>;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: [],
  selectedAgent: null,
  executions: [],
  loading: false,
  error: null,

  fetchAgents: async () => {
    set({ loading: true, error: null });
    try {
      const agents = await window.electronAPI.getAgents();
      set({ agents, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch agents', loading: false });
    }
  },

  selectAgent: (id: string) => {
    const agent = get().agents.find(a => a.id === id) || null;
    set({ selectedAgent: agent });
  },

  createAgent: async (input: CreateAgentInput) => {
    set({ loading: true, error: null });
    try {
      const agent = await window.electronAPI.createAgent(input);
      set(state => ({ agents: [...state.agents, agent], loading: false }));
      return agent;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to create agent', loading: false });
      throw error;
    }
  },

  updateAgent: async (id: string, updates: Partial<AgentConfig> & { avatar?: string | null }) => {
    set({ loading: true, error: null });
    try {
      const updated = await window.electronAPI.updateAgent(id, updates);
      set(state => ({
        agents: state.agents.map(a => a.id === id ? updated : a),
        selectedAgent: state.selectedAgent?.id === id ? updated : state.selectedAgent,
        loading: false,
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to update agent', loading: false });
      throw error;
    }
  },

  deleteAgent: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await window.electronAPI.deleteAgent(id);
      set(state => ({
        agents: state.agents.filter(a => a.id !== id),
        selectedAgent: state.selectedAgent?.id === id ? null : state.selectedAgent,
        loading: false,
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to delete agent', loading: false });
      throw error;
    }
  },

  executeAgent: async (id: string, input: Record<string, unknown>) => {
    set({ loading: true, error: null });
    try {
      const execution = await window.electronAPI.executeAgent(id, input);
      set(state => ({ executions: [execution, ...state.executions], loading: false }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to execute agent', loading: false });
      throw error;
    }
  },

  fetchExecutions: async (agentId?: string) => {
    set({ loading: true, error: null });
    try {
      const executions = await window.electronAPI.getAgentExecutions(agentId);
      set({ executions, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch executions', loading: false });
    }
  },

  cancelExecution: async (executionId: string) => {
    try {
      await window.electronAPI.cancelExecution(executionId);
      set(state => ({
        executions: state.executions.map(e => 
          e.id === executionId ? { ...e, status: 'cancelled' as const } : e
        ),
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to cancel execution' });
      throw error;
    }
  },
}));
