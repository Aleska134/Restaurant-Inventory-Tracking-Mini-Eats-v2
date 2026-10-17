import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ClipboardList, ChefHat, CheckCircle2, PackageCheck, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { Card, SectionTitle, Skeleton, Badge, Button, stagger, fadeUp } from '../components/ui';

type Status = 'RECEIVED' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED';
interface OrderItem { name: string; quantity: number; lineTotal: number; }
interface Order {
  id: string; status: Status; channel: string; source: string | null; placedAt: string;
  total: number; fulfillment: string | null; tableNumber: string | null; customerName: string | null;
  items: OrderItem[];
}

// What the manager can advance to from each state (mirrors the backend lifecycle).
const NEXT: Record<Status, { to: Status; label: string; icon: typeof ChefHat }[]> = {
  RECEIVED: [{ to: 'PREPARING', label: 'Start preparing', icon: ChefHat }, { to: 'CANCELLED', label: 'Cancel', icon: XCircle }],
  PREPARING: [{ to: 'READY', label: 'Mark ready', icon: CheckCircle2 }, { to: 'CANCELLED', label: 'Cancel', icon: XCircle }],
  READY: [{ to: 'COMPLETED', label: 'Mark picked up', icon: PackageCheck }],
  COMPLETED: [],
  CANCELLED: [],
};
const STATUS_TONE: Record<Status, 'brand' | 'warn' | 'ok' | 'neutral' | 'danger'> = {
  RECEIVED: 'brand', PREPARING: 'warn', READY: 'ok', COMPLETED: 'neutral', CANCELLED: 'danger',
};
const LANES: { status: Status; label: string }[] = [
  { status: 'RECEIVED', label: 'Received' },
  { status: 'PREPARING', label: 'Preparing' },
  { status: 'READY', label: 'Ready' },
];

export function Orders() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try { setOrders(await api<Order[]>('/orders')); } catch { /* keep last */ }
  }
  // Poll so the board reflects new customer orders + status moves ~live.
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  async function advance(id: string, to: Status) {
    setBusy(id + to);
    try {
      await api(`/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: to }) });
      await load();
    } finally { setBusy(null); }
  }

  if (!orders) {
    return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;
  }

  const active = orders.filter((o) => o.status === 'RECEIVED' || o.status === 'PREPARING' || o.status === 'READY');
  const done = orders.filter((o) => o.status === 'COMPLETED' || o.status === 'CANCELLED').slice(0, 12);

  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle right={<Badge tone="neutral">{active.length} active</Badge>}>
          <span className="flex items-center gap-1.5"><ClipboardList size={14} /> Live orders</span>
        </SectionTitle>
        {active.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">No active orders. New customer orders land here automatically.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {LANES.map((lane) => {
              const laneOrders = active.filter((o) => o.status === lane.status);
              return (
                <div key={lane.status} className="space-y-2">
                  <div className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted">
                    <Badge tone={STATUS_TONE[lane.status]}>{lane.label}</Badge>
                    <span>{laneOrders.length}</span>
                  </div>
                  <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-2">
                    <AnimatePresence>
                      {laneOrders.map((o) => (
                        <motion.div key={o.id} variants={fadeUp} layout className="rounded-xl glass-inset border border-transparent p-3">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">{o.id}</span>
                            <span className="text-xs text-muted">{money(o.total)}</span>
                          </div>
                          <div className="mt-0.5 text-xs text-muted">
                            {(o.customerName || 'Guest')}{o.fulfillment ? ` · ${o.fulfillment === 'for_here' ? 'For here' : 'To go'}` : ''}{o.tableNumber ? ` · T${o.tableNumber}` : ''}
                          </div>
                          <ul className="mt-2 space-y-0.5 text-xs">
                            {o.items.map((it, idx) => <li key={idx} className="flex justify-between gap-2"><span className="truncate">{it.quantity}× {it.name}</span></li>)}
                          </ul>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {NEXT[o.status].map((n) => {
                              const Icon = n.icon;
                              const danger = n.to === 'CANCELLED';
                              return (
                                <Button key={n.to} variant={danger ? 'ghost' : 'primary'} onClick={() => advance(o.id, n.to)} disabled={busy === o.id + n.to}>
                                  <Icon size={13} /> {busy === o.id + n.to ? '…' : n.label}
                                </Button>
                              );
                            })}
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    {laneOrders.length === 0 && <div className="rounded-xl border border-dashed border-border/60 py-6 text-center text-xs text-muted">—</div>}
                  </motion.div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle>Recently completed / cancelled</SectionTitle>
        {done.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Nothing yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {done.map((o) => (
              <li key={o.id} className="flex items-center gap-3 rounded-xl glass-inset border border-transparent p-2.5 text-sm">
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${o.status === 'COMPLETED' ? 'bg-ok/15 text-ok' : 'bg-danger/15 text-danger'}`}>
                  {o.status === 'COMPLETED' ? <PackageCheck size={16} /> : <XCircle size={16} />}
                </span>
                <span className="font-medium">{o.id}</span>
                <Badge tone={STATUS_TONE[o.status]}>{o.status}</Badge>
                <span className="ml-auto text-xs text-muted">{o.customerName || 'Guest'} · {money(o.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
