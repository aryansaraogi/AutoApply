/**
 * Optional site access.
 *
 * The six job boards in the manifest work out of the box. Everywhere else the
 * extension has no access at all — Chrome will not even reveal the page's URL —
 * and the per-site flow needs the address before it can ask for that origin.
 *
 * This is the escape hatch: one grant covering every site, so a user who applies
 * through many different company careers pages stops being asked. It is entirely
 * opt-in, never requested at install, and revocable from the same switch.
 */

/** Matches optional_host_permissions in the manifest; nothing broader is possible. */
const ALL_SITES: chrome.permissions.Permissions = {
  origins: ['https://*/*', 'http://*/*'],
};

export async function hasAllSiteAccess(): Promise<boolean> {
  try {
    return await chrome.permissions.contains(ALL_SITES);
  } catch {
    return false;
  }
}

/**
 * Must be called directly from a click — Chrome refuses a permission request
 * that is not attached to a user gesture, and does so silently.
 */
export async function requestAllSiteAccess(): Promise<boolean> {
  try {
    return await chrome.permissions.request(ALL_SITES);
  } catch {
    return false;
  }
}

export async function revokeAllSiteAccess(): Promise<boolean> {
  try {
    return await chrome.permissions.remove(ALL_SITES);
  } catch {
    return false;
  }
}
