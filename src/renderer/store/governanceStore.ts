import { create } from 'zustand';
import type { Approval, GovernanceRule } from '../../shared/types.js';

interface GovernanceStore {
  pendingApprovals: Approval[];
  rules: GovernanceRule[];
  loading: boolean;
  error: string | null;

  fetchPendingApprovals: () => Promise<void>;
  fetchRules: () => Promise<void>;
  approveAction: (actionId: string) => Promise<void>;
  rejectAction: (actionId: string, reason: string) => Promise<void>;
  setRule: (rule: GovernanceRule) => Promise<void>;
  deleteRule: (ruleId: string) => Promise<void>;
}

export const useGovernanceStore = create<GovernanceStore>((set, get) => ({
  pendingApprovals: [],
  rules: [],
  loading: false,
  error: null,

  fetchPendingApprovals: async () => {
    set({ loading: true, error: null });
    try {
      const approvals = await window.electronAPI.getPendingApprovals();
      set({ pendingApprovals: approvals, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch approvals', loading: false });
    }
  },

  fetchRules: async () => {
    set({ loading: true, error: null });
    try {
      const rules = await window.electronAPI.getGovernanceRules();
      set({ rules, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch rules', loading: false });
    }
  },

  approveAction: async (actionId: string) => {
    try {
      await window.electronAPI.approveAction(actionId);
      set(state => ({
        pendingApprovals: state.pendingApprovals.filter(a => a.id !== actionId),
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to approve action' });
      throw error;
    }
  },

  rejectAction: async (actionId: string, reason: string) => {
    try {
      await window.electronAPI.rejectAction(actionId, reason);
      set(state => ({
        pendingApprovals: state.pendingApprovals.filter(a => a.id !== actionId),
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to reject action' });
      throw error;
    }
  },

  setRule: async (rule: GovernanceRule) => {
    try {
      await window.electronAPI.setGovernanceRule(rule);
      set(state => ({
        rules: [...state.rules.filter(r => r.id !== rule.id), rule],
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to set rule' });
      throw error;
    }
  },

  deleteRule: async (ruleId: string) => {
    try {
      await window.electronAPI.deleteGovernanceRule(ruleId);
      set(state => ({
        rules: state.rules.filter(r => r.id !== ruleId),
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to delete rule' });
      throw error;
    }
  },
}));
