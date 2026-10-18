import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { UtensilsCrossed } from 'lucide-react';
import { Button, Card, fadeUp } from '../components/ui';
import { api } from '../lib/api';
import { setToken } from '../lib/auth';

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string | null }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (r.token) setToken(r.token);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log in');
    } finally {
      setBusy(false);
    }
  }

  const input =
    'w-full rounded-xl glass-inset px-3 py-2.5 text-sm text-text placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand';

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <motion.div {...fadeUp} className="w-full max-w-sm">
        <Card className="p-6">
          <div className="mb-6 flex items-center gap-2">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-brand-fg">
              <UtensilsCrossed size={20} />
            </div>
            <div>
              <div className="font-bold leading-tight">Barmade</div>
              <div className="text-xs text-muted">Manager Console</div>
            </div>
          </div>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <label className="text-sm font-medium">
              Email
              <input
                className={`${input} mt-1`}
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="manager@restaurant.com"
              />
            </label>
            <label className="text-sm font-medium">
              Password
              <input
                className={`${input} mt-1`}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <Button disabled={busy || !password} className="mt-2 w-full">
              {busy ? 'Logging in…' : 'Log in'}
            </Button>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}
