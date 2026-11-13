import { create } from 'zustand';
import type { Team, TeamConfig } from '../../shared/types.js';

interface TeamStore {
  teams: Team[];
  selectedTeam: Team | null;
  loading: boolean;
  error: string | null;

  fetchTeams: () => Promise<void>;
  selectTeam: (id: string) => void;
  createTeam: (config: TeamConfig) => Promise<void>;
  updateTeam: (id: string, config: Partial<TeamConfig>) => Promise<void>;
  deleteTeam: (id: string) => Promise<void>;
  addAgentToTeam: (teamId: string, agentId: string) => Promise<void>;
  removeAgentFromTeam: (teamId: string, agentId: string) => Promise<void>;
  executeTeam: (teamId: string, input: Record<string, unknown>) => Promise<{
    teamId: string;
    status: 'completed' | 'failed' | 'partial';
    results: Array<{
      agentId: string;
      agentName: string;
      status: 'completed' | 'failed';
      output?: Record<string, unknown>;
      error?: string;
    }>;
    duration: number;
  }>;
}

export const useTeamStore = create<TeamStore>((set, get) => ({
  teams: [],
  selectedTeam: null,
  loading: false,
  error: null,

  fetchTeams: async () => {
    set({ loading: true, error: null });
    try {
      const teams = await window.electronAPI.getTeams();
      set({ teams, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch teams', loading: false });
    }
  },

  selectTeam: (id: string) => {
    const team = get().teams.find(t => t.id === id) || null;
    set({ selectedTeam: team });
  },

  createTeam: async (config: TeamConfig) => {
    set({ loading: true, error: null });
    try {
      const team = await window.electronAPI.createTeam(config);
      set(state => ({ teams: [...state.teams, team], loading: false }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to create team', loading: false });
      throw error;
    }
  },

  updateTeam: async (id: string, config: Partial<TeamConfig>) => {
    set({ loading: true, error: null });
    try {
      const updated = await window.electronAPI.updateTeam(id, config);
      set(state => ({
        teams: state.teams.map(t => t.id === id ? updated : t),
        selectedTeam: state.selectedTeam?.id === id ? updated : state.selectedTeam,
        loading: false,
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to update team', loading: false });
      throw error;
    }
  },

  deleteTeam: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await window.electronAPI.deleteTeam(id);
      set(state => ({
        teams: state.teams.filter(t => t.id !== id),
        selectedTeam: state.selectedTeam?.id === id ? null : state.selectedTeam,
        loading: false,
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to delete team', loading: false });
      throw error;
    }
  },

  addAgentToTeam: async (teamId: string, agentId: string) => {
    try {
      const updated = await window.electronAPI.addAgentToTeam(teamId, agentId);
      set(state => ({
        teams: state.teams.map(t => t.id === teamId ? updated : t),
        selectedTeam: state.selectedTeam?.id === teamId ? updated : state.selectedTeam,
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to add agent to team' });
      throw error;
    }
  },

  removeAgentFromTeam: async (teamId: string, agentId: string) => {
    try {
      const updated = await window.electronAPI.removeAgentFromTeam(teamId, agentId);
      set(state => ({
        teams: state.teams.map(t => t.id === teamId ? updated : t),
        selectedTeam: state.selectedTeam?.id === teamId ? updated : state.selectedTeam,
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to remove agent from team' });
      throw error;
    }
  },

  executeTeam: async (teamId: string, input: Record<string, unknown>) => {
    set({ loading: true, error: null });
    try {
      const result = await window.electronAPI.executeTeam(teamId, input);
      set({ loading: false });
      return result;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to execute team', loading: false });
      throw error;
    }
  },
}));
