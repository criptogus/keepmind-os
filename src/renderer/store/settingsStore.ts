import { create } from 'zustand';
import type { AppSettings } from '../../shared/types.js';
import { DEFAULT_MODEL } from '../../shared/models.js';

interface SettingsStore {
  settings: AppSettings;
  loading: boolean;
  error: string | null;

  fetchSettings: () => Promise<void>;
  updateSettings: (settings: Partial<AppSettings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: {
    theme: 'auto',
    language: 'en',
    autoApprove: false,
    defaultModel: DEFAULT_MODEL.openai,
    maxConcurrentExecutions: 5,
    auditRetentionDays: 30,
  },
  loading: false,
  error: null,

  fetchSettings: async () => {
    set({ loading: true, error: null });
    try {
      const settings = await window.electronAPI.getSettings();
      set({ settings, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch settings', loading: false });
    }
  },

  updateSettings: async (newSettings: Partial<AppSettings>) => {
    set({ loading: true, error: null });
    try {
      await window.electronAPI.updateSettings(newSettings);
      set(state => ({
        settings: { ...state.settings, ...newSettings },
        loading: false,
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to update settings', loading: false });
      throw error;
    }
  },
}));
