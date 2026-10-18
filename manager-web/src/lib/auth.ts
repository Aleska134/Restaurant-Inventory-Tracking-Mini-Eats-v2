// The manager's login token, kept in this browser. See backend/src/lib/auth.ts for how it's checked.
const KEY = 'barmade_manager_token';
const LOGOUT_EVENT = 'barmade:logout';

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string) {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    /* private mode: login lasts until the tab closes */
  }
}

/** Forget the token and send the user back to the login screen. */
export function logout() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(LOGOUT_EVENT));
}

export function onLogout(handler: () => void) {
  window.addEventListener(LOGOUT_EVENT, handler);
  return () => window.removeEventListener(LOGOUT_EVENT, handler);
}
