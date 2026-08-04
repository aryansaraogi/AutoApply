import { SCHEMA_VERSION } from './schema';

export type AiProvider = 'anthropic';

export interface Settings {
  schemaVersion: number;
  /** AI assist is opt-in and stays off until the user turns it on *and* supplies a key. */
  aiEnabled: boolean;
  aiProvider: AiProvider;
  aiModel: string;
  /** Outline filled fields in the page after a fill pass. */
  highlightFills: boolean;
  /** Watch for a submit and promote the log entry from "filled" to "submitted". */
  trackSubmissions: boolean;
}

const SETTINGS_KEY = 'settings';

/** Kept under its own storage key rather than inside Settings so that anything
 *  which logs or exports settings cannot accidentally carry the key with it. */
const API_KEY_KEY = 'aiApiKey';

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SCHEMA_VERSION,
  aiEnabled: false,
  aiProvider: 'anthropic',
  aiModel: 'claude-opus-5',
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

export async function loadApiKey(): Promise<string> {
  const stored = await chrome.storage.local.get(API_KEY_KEY);
  const key = stored[API_KEY_KEY];
  return typeof key === 'string' ? key : '';
}

export async function saveApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed) await chrome.storage.local.set({ [API_KEY_KEY]: trimmed });
  else await chrome.storage.local.remove(API_KEY_KEY);
}

/** True when AI assist is both switched on and actually usable. */
export async function aiReady(): Promise<boolean> {
  const [settings, key] = await Promise.all([loadSettings(), loadApiKey()]);
  return settings.aiEnabled && key !== '';
}
