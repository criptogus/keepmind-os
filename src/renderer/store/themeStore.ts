import { create } from 'zustand';

type Theme = 'light' | 'dark' | 'auto';
interface ThemeStore {
  theme: Theme;
  loading: boolean;
  initTheme: () => Promise<void>;
  setTheme: (theme: Theme) => Promise<void>;
  toggleTheme: () => Promise<void>;
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: 'auto',
  loading: false,
  initTheme: async () => {
    try { const settings = await window.electronAPI.getSettings(); set({ theme: settings.theme }); }
    catch (error) { console.error('Failed to load theme:', error); }
  },
  setTheme: async (theme) => {
    set({ loading: true });
    try { await window.electronAPI.updateSettings({ theme }); set({ theme }); }
    finally { set({ loading: false }); }
  },
  toggleTheme: async () => {
    const dark = get().theme === 'dark' || (get().theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    await get().setTheme(dark ? 'light' : 'dark');
  },
}));
