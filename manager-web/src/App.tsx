import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  LayoutDashboard, Boxes, LineChart, Bell, Sparkles, Moon, Sun, Zap, UtensilsCrossed, CalendarRange, ShoppingCart, Store, ClipboardList,
} from 'lucide-react';
import { Dashboard } from './pages/Dashboard';
import { AllTime } from './pages/AllTime';
import { Inventory } from './pages/Inventory';
import { Sales } from './pages/Sales';
import { Alerts } from './pages/Alerts';
import { CartPage } from './pages/CartPage';
import { Vendors } from './pages/Vendors';
import { Orders } from './pages/Orders';
import { CloseDay } from './pages/CloseDay';
import { Button } from './components/ui';
import { api } from './lib/api';

type Tab = 'dashboard' | 'alltime' | 'inventory' | 'sales' | 'alerts' | 'cart' | 'vendors' | 'orders' | 'closeday';

const NAV: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'alltime', label: 'All-time', icon: CalendarRange },
  { id: 'inventory', label: 'Inventory', icon: Boxes },
  { id: 'sales', label: 'Sales', icon: LineChart },
  { id: 'orders', label: 'Orders', icon: ClipboardList },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'cart', label: 'Cart', icon: ShoppingCart },
  { id: 'vendors', label: 'Vendors', icon: Store },
  { id: 'closeday', label: 'Close Day', icon: Sparkles },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [dark, setDark] = useState(true);
  const [bump, setBump] = useState(0); // increments to force child refetch
  const [rushing, setRushing] = useState(false);
  const [counts, setCounts] = useState<{ cart: number; alerts: number }>({ cart: 0, alerts: 0 });

  // Live nav badges: poll cart + active-alert counts (and refresh on tab/bump).
  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const [cart, alerts] = await Promise.all([
          api<{ count: number }>('/cart').catch(() => ({ count: 0 })),
          api<any[]>('/alerts?status=ACTIVE').catch(() => []),
        ]);
        if (alive) setCounts({ cart: cart.count ?? 0, alerts: Array.isArray(alerts) ? alerts.length : 0 });
      } catch { /* ignore */ }
    }
    refresh();
    const t = setInterval(refresh, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [tab, bump]);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
  }

  async function simulateRush() {
    setRushing(true);
    try {
      await api('/simulate/rush', { method: 'POST', body: JSON.stringify({ count: 18 }) });
      setBump((b) => b + 1);
    } finally {
      setRushing(false);
    }
  }

  // Live restaurant open/closed state, shown as a status pill in the header.
  // The single Close/Open action lives on the Close Day page (one button, two
  // states) so there is never a close+open pair visible at once.
  const [dayClosed, setDayClosed] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () => api<{ closed: boolean }>('/status').then((s) => { if (alive) setDayClosed(s.closed); }).catch(() => {});
    read();
    const t = setInterval(read, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [bump, tab]);

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="glass sticky top-0 hidden h-screen w-60 flex-col rounded-none border-y-0 border-l-0 p-4 md:flex">
        <div className="mb-8 flex items-center gap-2 px-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-brand-fg">
            <UtensilsCrossed size={18} />
          </div>
          <div>
            <div className="text-sm font-bold leading-tight">Barmade</div>
            <div className="text-xs text-muted">Manager Console</div>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => {
            const Icon = n.icon;
            const active = tab === n.id;
            return (
              <button
                key={n.id}
                onClick={() => setTab(n.id)}
                className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  active ? 'text-brand' : 'text-muted hover:bg-surface-2 hover:text-text'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-xl bg-brand/12"
                    transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                  />
                )}
                <Icon size={18} className="relative z-10" />
                <span className="relative z-10">{n.label}</span>
                {((n.id === 'cart' && counts.cart > 0) || (n.id === 'alerts' && counts.alerts > 0)) && (
                  <span className="relative z-10 ml-auto grid min-w-5 place-items-center rounded-full bg-brand px-1.5 text-xs font-bold text-brand-fg">
                    {n.id === 'cart' ? counts.cart : counts.alerts}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto">
          <button
            onClick={toggleTheme}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-text"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
            {dark ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1">
        <header className="glass sticky top-0 z-20 flex items-center justify-between rounded-none border-x-0 border-t-0 px-6 py-4">
          <div>
            <h1 className="text-xl font-bold capitalize">{NAV.find((n) => n.id === tab)?.label}</h1>
            <p className="text-sm text-muted">Trattoria Little Italy · synthetic demo</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={simulateRush} disabled={rushing}>
              <Zap size={16} />
              {rushing ? 'Simulating…' : 'Simulate rush'}
            </Button>
            <Button onClick={() => setTab('closeday')} variant={dayClosed ? 'ghost' : 'primary'}>
              <Sparkles size={16} /> {dayClosed === null ? 'Day' : dayClosed ? 'Closed — open day' : 'Open — close day'}
            </Button>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6 py-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab + bump}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22 }}
            >
              {tab === 'dashboard' && <Dashboard onNavigate={setTab} />}
              {tab === 'alltime' && <AllTime />}
              {tab === 'inventory' && <Inventory />}
              {tab === 'sales' && <Sales />}
              {tab === 'alerts' && <Alerts />}
              {tab === 'cart' && <CartPage onNavigate={setTab} />}
              {tab === 'vendors' && <Vendors />}
              {tab === 'orders' && <Orders />}
              {tab === 'closeday' && <CloseDay />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
