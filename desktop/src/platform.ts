/** The OS name for the system credential store; used only in the keychain-unavailable copy. */
export function keychainLabel(ua: string = navigator.userAgent): string {
  if (/Windows/i.test(ua)) return 'Credential Manager';
  if (/Mac/i.test(ua)) return 'Keychain';
  return 'Secret Service';
}

/** Where the webview loads a stored thumbnail from; Windows serves custom schemes on a localhost host name. */
export function thumbUrl(batch: string, photo: string, ua: string = navigator.userAgent): string {
  const origin = /Windows/i.test(ua) ? 'http://klei-img.localhost' : 'klei-img://localhost';
  return `${origin}/${batch}/${photo}`;
}

/** The original photo through the same scheme (Story 4.5); the app fetches it on demand and never keeps it. */
export function fullUrl(batch: string, photo: string, ua: string = navigator.userAgent): string {
  return `${thumbUrl(batch, photo, ua)}/full`;
}

/** A saved Gown's thumbnail (Story 5.1) through the same scheme; the app serves it from memory for a few minutes. */
export function gownThumbUrl(gown: string, photo: string, ua: string = navigator.userAgent): string {
  return `${thumbUrl('g', gown, ua)}/${photo}`;
}

/** A saved Gown's original photo (Story 5.2); fetched on demand and never kept. */
export function gownFullUrl(gown: string, photo: string, ua: string = navigator.userAgent): string {
  return `${gownThumbUrl(gown, photo, ua)}/full`;
}

/** The signed-in User's own avatar; `revision` comes from `/api/v1/me` and only busts the webview's cache. */
export function avatarUrl(revision: number, ua: string = navigator.userAgent): string {
  return thumbUrl('me', String(revision), ua);
}
