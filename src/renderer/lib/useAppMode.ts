import { useCallback, useEffect, useState } from 'react';

export type AppMode = 'personal' | 'corporate' | 'unset';

let cached: AppMode | null = null;
const listeners = new Set<(m: AppMode) => void>();

function publish(mode: AppMode) {
  cached = mode;
  listeners.forEach((fn) => fn(mode));
}

/** Shared app-mode state: 'unset' until the user picks personal or corporate. */
export function useAppMode(): { mode: AppMode; setMode: (m: 'personal' | 'corporate') => Promise<void>; ready: boolean } {
  const [mode, setModeState] = useState<AppMode>(cached ?? 'unset');
  const [ready, setReady] = useState(cached !== null);

  useEffect(() => {
    const fn = (m: AppMode) => {
      setModeState(m);
      setReady(true);
    };
    listeners.add(fn);
    if (cached === null) {
      window.electronAPI
        .appGetMode()
        .then((m) => {
          cached = m;
          fn(m);
        })
        .catch(() => fn('unset'));
    }
    return () => {
      listeners.delete(fn);
    };
  }, []);

  const setMode = useCallback(async (m: 'personal' | 'corporate') => {
    const res = await window.electronAPI.appSetMode(m);
    if (res.ok) publish(m);
  }, []);

  return { mode, setMode, ready };
}
