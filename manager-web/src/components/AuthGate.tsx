import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { getToken, onLogout } from '../lib/auth';
import { Login } from '../pages/Login';

type State = 'checking' | 'login' | 'in' | 'off';

/** Shows the login screen until the manager is logged in (when the backend requires it). */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>('checking');

  async function check() {
    let required = true;
    try {
      required = (await api<{ required: boolean }>('/auth/config')).required;
    } catch (err) {
      // A backend without the login feature (older deploy) answers 404: don't lock the dashboard.
      if (err instanceof Error && err.message.includes('404')) required = false;
    }
    if (!required) return setState('off');
    if (!getToken()) return setState('login');
    try {
      await api('/auth/me'); // fails if the saved token expired or the password changed
      setState('in');
    } catch {
      setState('login');
    }
  }

  useEffect(() => {
    check();
    return onLogout(() => setState('login'));
  }, []);

  if (state === 'checking') return <div className="grid min-h-screen place-items-center text-sm text-muted">Loading…</div>;
  if (state === 'login') return <Login onLoggedIn={() => setState('in')} />;
  return (
    <>
      {state === 'off' && (
        <div className="bg-warn/15 px-4 py-2 text-center text-xs font-medium text-warn">
          Manager login is off: set MANAGER_PASSWORD on the backend to require a login.
        </div>
      )}
      {children}
    </>
  );
}
