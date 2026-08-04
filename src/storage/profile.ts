import { type Profile, emptyProfile, normalizeProfile } from './schema';

const PROFILE_KEY = 'profile';

export async function loadProfile(): Promise<Profile> {
  const stored = await chrome.storage.local.get(PROFILE_KEY);
  return normalizeProfile(stored[PROFILE_KEY]);
}

export async function saveProfile(profile: Profile): Promise<void> {
  await chrome.storage.local.set({ [PROFILE_KEY]: normalizeProfile(profile) });
}

export async function clearProfile(): Promise<void> {
  await chrome.storage.local.set({ [PROFILE_KEY]: emptyProfile() });
}

/** Fires when the profile changes in any extension context — lets an open
 *  sidepanel stay in sync with edits made in the Options page. */
export function onProfileChanged(handler: (profile: Profile) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName,
  ) => {
    if (area !== 'local') return;
    const change = changes[PROFILE_KEY];
    if (change) handler(normalizeProfile(change.newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
