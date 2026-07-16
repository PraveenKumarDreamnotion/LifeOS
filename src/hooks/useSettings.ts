import { useCallback, useEffect, useState } from 'react';
import { ipc, type SettingsUpdate } from '../lib/ipc';
import type { SettingsDto } from '../../core/types/ipc';

/** Applies the theme setting to the document root (12 §2.1). `system` follows the OS. */
function applyTheme(theme: SettingsDto['theme']) {
  const root = document.documentElement;
  if (theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<SettingsDto | null>(null);

  const refresh = useCallback(async () => {
    const s = await ipc.getSettings();
    setSettings(s);
    applyTheme(s.theme);
  }, []);

  useEffect(() => {
    void refresh();
    const unsub = ipc.onSettingsChanged(() => void refresh());
    return unsub;
  }, [refresh]);

  const update = useCallback(
    async (patch: SettingsUpdate) => {
      await ipc.updateSettings(patch);
      await refresh();
    },
    [refresh],
  );

  return { settings, update, refresh };
}
