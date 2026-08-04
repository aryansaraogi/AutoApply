import { SCHEMA_VERSION } from './schema';

export interface Settings {
  schemaVersion: number;
  /** Outline filled fields in the page after a fill pass. */
  highlightFills: boolean;
  /** Watch for a submit and advance the tracker entry from draft to applied. */
  trackSubmissions: boolean;
}

const SETTINGS_KEY = 'settings';

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SCHEMA_VERSION,
  highlightFills: true,
  trackSubmissions: true,
};

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const raw = stored[SETTINGS_KEY];
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...(raw as Partial<Settings>) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
