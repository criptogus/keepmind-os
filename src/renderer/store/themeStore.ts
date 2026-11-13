import { create } from 'zustand';
import type { AppSettings } from '../../shared/types.js';

interface ThemeStore {
  theme: 'light' | 'dark' | 'auto';
  isDark: boolean;
  loading: boolean;

  initTheme: () => Promise<void>;
  setTheme: (theme: 'light' | 'dark' | 'auto') => Promise<void>;
  toggleTheme: () => Promise<void>;
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: 'auto',
  isDark: false,
  loading: false,

  initTheme: async () => {
    try {
      const settings = await window.electronAPI.getSettings();
      set({ theme: settings.theme });
      updateTheme(settings.theme);
      // 'auto' follows OS changes live.
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (get().theme === 'auto') updateTheme('auto');
      });
    } catch (error) {
      console.error('Failed to load theme:', error);
    }
  },

  setTheme: async (theme) => {
    set({ loading: true });
    try {
      await window.electronAPI.updateSettings({ theme });
      set({ theme });
      updateTheme(theme);
    } catch (error) {
      console.error('Failed to set theme:', error);
    } finally {
      set({ loading: false });
    }
  },

  toggleTheme: async () => {
    const current = get().theme;
    const newTheme = current === 'dark' ? 'light' : 'dark';
    await get().setTheme(newTheme);
  },
}));

function updateTheme(theme: 'light' | 'dark' | 'auto') {
  const isDark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  // Mantine reads the color scheme from this attribute (not a .dark class).
  document.documentElement.setAttribute('data-mantine-color-scheme', isDark ? 'dark' : 'light');
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';

  // Update CSS variables
  if (isDark) {
    document.documentElement.style.setProperty('--bg-color', '#1f2937');
    document.documentElement.style.setProperty('--text-color', '#f9fafb');
    document.documentElement.style.setProperty('--border-color', '#374151');
  } else {
    document.documentElement.style.setProperty('--bg-color', '#ffffff');
    document.documentElement.style.setProperty('--text-color', '#111827');
    document.documentElement.style.setProperty('--border-color', '#e5e7eb');
  }
}
