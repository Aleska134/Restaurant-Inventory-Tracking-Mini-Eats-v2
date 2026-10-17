import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Legend,
} from 'recharts';
import { DollarSign, ShoppingBag, TriangleAlert, PackageX, UtensilsCrossed, Clock, X, ChevronRight, ClipboardList } from 'lucide-react';
import { useApi } from '../lib/api';
import { money, num } from '../lib/format';
import { Card, SectionTitle, StatCard, Skeleton, Badge, stagger } from '../components/ui';

interface Overview {
  demoDate: string;
  today: { orders: number; gross: number; fees: number; net: number };
  channelMixToday: { channel: string; gross: number; net: number; orders: number; feePct: number }[];
  activeAlerts: number;
  lowStockCount: number;
  overstockCount: number;
}
type Dish = { key: string; name: string; qty: number; revenue: number };
type DishStatus = {
  key: string; name: string; category: string; available: boolean;
  servingsRemaining: number | null; status: 'sold_out' | 'attention' | 'safe';
  limitingIngredient: { name: string; servingsPossible: number } | null;
};

export function Dashboard({ onNavigate }: { onNavigate: (t: any) => void }) {
  const ov = useApi<Overview>('/overview');
  const todayDate = ov.data?.demoDate;
  // Calendar: when set, the dashboard shows that PAST day instead of live today.
  const [picked, setPicked] = useState<string>('');
  const viewing = picked || todayDate; // the date currently displayed
  const isToday = !picked || picked === todayDate;

  // Per-day totals (used to fill KPIs when viewing a past day).
  const byDay = useApi<{ businessDate: string; orders: number; gross: number; fees: number; net: number }[]>('/sales/by-day');
  const dayRow = (byDay.data ?? []).find((d) => d.businessDate === viewing);

  // Dishes sold on the VIEWED day (live today, or the picked historical day).
  const dishesToday = useApi<Dish[]>(viewing ? `/sales/by-dish?date=${viewing}` : '', [viewing]);
  const dishStatus = useApi<DishStatus[]>('/dishes/status');
  const [openDish, setOpenDish] = useState<string | null>(null);

  const o = ov.data;
  // KPIs: live overview for today; otherwise the picked day's row from by-day.
  const kpi = isToday
    ? o?.today
    : dayRow ?? { orders: 0, gross: 0, fees: 0, net: 0 };
  const topToday = (dishesToday.data ?? []).filter((d) => d.qty > 0).slice(0, 8);
  const dishes = dishStatus.data ?? [];
  const needAttention = dishes.filter((d) => d.status !== 'safe');

  return (
    <div className="space-y-6">
      {/* Current-day banner + calendar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Clock size={15} className="text-brand" />
          <span>{isToday ? 'Today' : 'Viewing'} — <span className="font-semibold text-text">{viewing ?? '—'}</span></span>
          {isToday ? <Badge tone="ok">live</Badge> : <Badge tone="neutral">past day</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={picked || todayDate || ''}
            max={todayDate}
            onChange={(e) => setPicked(e.target.value === todayDate ? '' : e.target.value)}
            className="rounded-lg glass-inset border border-transparent px-2.5 py-1.5 text-xs text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-brand [color-scheme:dark]"
            title="Pick a day to see that day's sales"
          />
          {!isToday && (
            <button onClick={() => setPicked('')} className="text-xs font-medium text-brand hover:underline">Back to today →</button>
          )}
        </div>
      </div>

      {/* KPIs for the viewed day */}
      <motion.div variants={stagger} initial="initial" animate="animate" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={isToday ? 'Orders today' : 'Orders'} value={kpi ? num(kpi.orders) : ''} sub={kpi ? `fees ${money(kpi.fees)}` : undefined} icon={<ShoppingBag size={16} />} tone="ok" loading={ov.loading || (!isToday && byDay.loading)} />
        <StatCard label={isToday ? 'Net revenue today' : 'Net revenue'} value={kpi ? money(kpi.net) : ''} sub={kpi ? `${money(kpi.gross)} gross` : undefined} icon={<DollarSign size={16} />} tone="brand" loading={ov.loading || (!isToday && byDay.loading)} />
        <StatCard label="Active alerts" value={o ? num(o.activeAlerts) : ''} sub="needs attention" icon={<TriangleAlert size={16} />} tone="warn" loading={ov.loading} />
        <StatCard label="Low / out of stock" value={o ? num(o.lowStockCount) : ''} sub={o ? `${o.overstockCount} overstocked` : undefined} icon={<PackageX size={16} />} tone="danger" loading={ov.loading} />
      </motion.div>

      {/* Dishes sold on the viewed day */}
      <Card>
        <SectionTitle right={<Badge tone="neutral">{isToday ? 'updates live' : viewing}</Badge>}>
          <span className="flex items-center gap-1.5"><UtensilsCrossed size={14} /> {isToday ? 'Dishes sold today' : `Dishes sold on ${viewing}`}</span>
        </SectionTitle>
        {dishesToday.loading || !viewing ? (
          <Skeleton className="h-64 w-full" />
        ) : topToday.length ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topToday} layout="vertical" margin={{ left: 40, right: 16 }}>
              <XAxis type="number" tick={{ fontSize: 11, fill: 'rgb(148 163 184)' }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: 'rgb(148 163 184)' }} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="qty" fill="rgb(245 158 11)" radius={[0, 6, 6, 0]} name="Sold today" />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="py-16 text-center text-sm text-muted">
            <UtensilsCrossed size={28} className="mx-auto mb-2 opacity-40" />
            No dishes sold yet today.
            <div className="mt-1 text-xs">Counts fill in as orders arrive from the customer app — or press “Simulate rush”.</div>
          </div>
        )}
      </Card>

      {/* Projection: inventory expectation vs actual usage today */}
      <ProjectionCard />

      {/* Menu readiness — dishes by status (click a dish for its recipe vs stock) */}
      <Card>
        <SectionTitle right={<button onClick={() => onNavigate('inventory')} className="text-xs font-medium text-brand">Inventory →</button>}>
          <span className="flex items-center gap-1.5"><UtensilsCrossed size={14} /> Menu readiness — what you can serve</span>
        </SectionTitle>
        {dishStatus.loading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-2 text-xs">
              <span className="flex items-center gap-1.5"><Dot tone="danger" /> {dishes.filter((d) => d.status === 'sold_out').length} sold out</span>
              <span className="flex items-center gap-1.5"><Dot tone="warn" /> {dishes.filter((d) => d.status === 'attention').length} need attention</span>
              <span className="flex items-center gap-1.5"><Dot tone="ok" /> {dishes.filter((d) => d.status === 'safe').length} safe</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(needAttention.length ? needAttention : dishes).map((d) => (
                <button
                  key={d.key}
                  onClick={() => setOpenDish(d.key)}
                  className="flex items-center justify-between gap-2 rounded-xl glass-inset border border-transparent px-3 py-2.5 text-left transition-colors hover:border-brand/40"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{d.name}</div>
                    <div className="truncate text-xs text-muted">
                      {d.status === 'sold_out'
                        ? (d.available ? `out of ${d.limitingIngredient?.name ?? 'an ingredient'}` : 'manually 86’d')
                        : d.limitingIngredient
                        ? `${d.servingsRemaining} left · limited by ${d.limitingIngredient.name}`
                        : `${d.servingsRemaining ?? '—'} servings`}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <DishBadge status={d.status} />
                    <ChevronRight size={14} className="text-muted" />
                  </div>
                </button>
              ))}
            </div>
            {!needAttention.length && <p className="mt-3 text-center text-sm text-muted">Every dish is safe to serve. 🎉</p>}
          </>
        )}
      </Card>

      <AnimatePresence>
        {openDish && <DishModal dishKey={openDish} onClose={() => setOpenDish(null)} />}
      </AnimatePresence>
    </div>
  );
}

function Dot({ tone }: { tone: 'ok' | 'warn' | 'danger' }) {
  const c = { ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger' }[tone];
  return <span className={`h-2.5 w-2.5 rounded-full ${c}`} />;
}

type Projection = {
  businessDate: string; projectedDayTotal: number; actualTotal: number; historyDays: number;
  rows: { key: string; name: string; expected: number; actual: number; variance: number }[];
};

function ProjectionCard() {
  const proj = useApi<Projection>('/projection');
  const p = proj.data;
  // Top dishes by combined volume, so the chart leads with what matters.
  const data = (p?.rows ?? [])
    .slice()
    .sort((a, b) => (b.actual + b.expected) - (a.actual + a.expected))
    .slice(0, 10)
    .map((r) => ({ ...r, label: r.name }));

  return (
    <Card>
      <SectionTitle
        right={p ? <span className="text-xs text-muted">projected {num(p.projectedDayTotal)} · actual {num(p.actualTotal)} items</span> : undefined}
      >
        <span className="flex items-center gap-1.5"><ClipboardList size={14} /> Projection — expected vs actual sales by item</span>
      </SectionTitle>
      <p className="mb-3 text-xs text-muted">
        Expected = each dish’s historical share of a typical day. Actual = sold today. Recalibrates as live orders arrive.
      </p>
      {proj.loading ? (
        <Skeleton className="h-72 w-full" />
      ) : data.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No sales recorded today yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(220, data.length * 48)}>
          <BarChart data={data} layout="vertical" margin={{ left: 40, right: 16, top: 4 }} barGap={3} barCategoryGap="22%">
            <XAxis type="number" tick={{ fontSize: 11, fill: 'rgb(148 163 184)' }} allowDecimals={false} />
            <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 11, fill: 'rgb(148 163 184)' }} />
            <Tooltip content={<ProjTip />} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="expected" fill="rgb(148 163 184)" radius={[0, 4, 4, 0]} name="Expected" maxBarSize={14} />
            <Bar dataKey="actual" fill="rgb(245 158 11)" radius={[0, 4, 4, 0]} name="Actual" maxBarSize={14} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

function ProjTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const exp = payload.find((p: any) => p.dataKey === 'expected')?.value ?? 0;
  const act = payload.find((p: any) => p.dataKey === 'actual')?.value ?? 0;
  const variance = act - exp;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold">{label}</div>
      <div className="text-muted">Expected: {num(exp)}</div>
      <div className="text-muted">Actual: {num(act)}</div>
      <div className={variance === 0 ? 'text-muted' : variance > 0 ? 'text-ok' : 'text-danger'}>
        {variance > 0 ? '+' : ''}{num(variance)} vs expected
      </div>
    </div>
  );
}

function DishBadge({ status }: { status: DishStatus['status'] }) {
  if (status === 'sold_out') return <Badge tone="danger">Sold out</Badge>;
  if (status === 'attention') return <Badge tone="warn">Needs attention</Badge>;
  return <Badge tone="ok">Safe</Badge>;
}

interface DishDetail {
  key: string; name: string; category: string; available: boolean;
  servingsRemaining: number | null; status: 'sold_out' | 'attention' | 'safe';
  limitingIngredient: { name: string; servingsPossible: number | null } | null;
  ingredients: { ingredientId: string; name: string; unit: string; perServing: number; onHand: number; servingsPossible: number | null; status: string }[];
}

function DishModal({ dishKey, onClose }: { dishKey: string; onClose: () => void }) {
  const d = useApi<DishDetail>(`/dishes/${dishKey}/status`);
  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="w-full max-w-lg rounded-2xl border border-border bg-surface p-5 shadow-xl"
        initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 12 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
      >
        {d.loading || !d.data ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <>
            <div className="mb-1 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold">{d.data.name}</h3>
                <p className="text-xs text-muted">{d.data.category}</p>
              </div>
              <button onClick={onClose} className="text-muted hover:text-text"><X size={18} /></button>
            </div>
            <div className="mb-4 flex items-center gap-2">
              <DishBadge status={d.data.status} />
              <span className="text-sm text-muted">
                {d.data.servingsRemaining !== null ? `${num(d.data.servingsRemaining)} servings possible` : 'no recipe'}
                {d.data.limitingIngredient && ` · limited by ${d.data.limitingIngredient.name}`}
              </span>
            </div>
            <div className="text-xs uppercase tracking-wide text-muted">Recipe — needs per serving vs on hand</div>
            <div className="mt-2 space-y-1.5">
              {d.data.ingredients.map((ing) => {
                const short = ing.servingsPossible !== null && ing.servingsPossible < 10;
                return (
                  <div key={ing.ingredientId} className="flex items-center justify-between gap-2 rounded-lg glass-inset border border-transparent px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">{ing.name}</span>
                      <span className="ml-2 text-xs text-muted">needs {num(ing.perServing)} {ing.unit}/serving</span>
                    </div>
                    <div className={`shrink-0 text-right text-xs ${short ? 'text-danger' : 'text-muted'}`}>
                      <div className="tabular-nums">{num(ing.onHand)} {ing.unit} on hand</div>
                      <div>{ing.servingsPossible !== null ? `${num(ing.servingsPossible)} servings` : '—'}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      {label && <div className="mb-1 font-semibold">{label}</div>}
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.stroke }} />
          {p.name}: <span className="font-medium">{num(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

