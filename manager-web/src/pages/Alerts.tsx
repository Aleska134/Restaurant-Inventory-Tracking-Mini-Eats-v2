import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TriangleAlert, CheckCircle2, PackageX, Clock, Sparkles, Truck, Ban, Wand2, Check, Replace, EyeOff } from 'lucide-react';
import { useApi, api } from '../lib/api';
import { num } from '../lib/format';
import { Card, SectionTitle, Skeleton, Badge, Button, stagger, fadeUp } from '../components/ui';

interface Alert {
  id: string; type: string; status: string; severity: string;
  ingredientName: string; currentQuantity: number | null; reorderPoint: number | null;
  unit: string | null; message: string; createdAt: string;
}
interface Suggestion { alertId: string; ingredient: string; recommended: 'reorder' | 'eighty_six' | 'monitor'; reason: string; dependentDishes: string[]; }
interface Classify { ingredient: string; isEssentialSomewhere: boolean; essentialDishes: string[]; secondaryDishes: string[]; }
interface SubOption { id: string; name: string; category: string; currentStock: number; unit: string; }

const sevTone = { critical: 'danger', high: 'warn', medium: 'warn', low: 'neutral' } as const;

export function Alerts() {
  const [filter, setFilter] = useState<'ACTIVE' | 'RESOLVED'>('ACTIVE');
  const alerts = useApi<Alert[]>(`/alerts?status=${filter}`, [filter]);
  const cart = useApi<{ count: number }>('/cart');

  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [suggestModel, setSuggestModel] = useState<string | null>(null);

  function refetchAll() { alerts.refetch(); cart.refetch(); }

  async function getSuggestions() {
    setSuggesting(true);
    try {
      const r = await api<{ model: string; actions: Suggestion[] }>('/alerts/suggest', { method: 'POST', body: JSON.stringify({}) });
      setSuggestions(r.actions); setSuggestModel(r.model);
    } finally { setSuggesting(false); }
  }

  return (
    <div className="space-y-6">
      {filter === 'ACTIVE' && (
        <Card className="border-brand/30">
          <SectionTitle
            right={
              <div className="flex items-center gap-2">
                {suggestModel && <Badge tone="brand">{suggestModel}</Badge>}
                <Button variant="ghost" onClick={getSuggestions} disabled={suggesting}>
                  <Wand2 size={15} /> {suggesting ? 'Thinking…' : 'Suggest solutions'}
                </Button>
              </div>
            }
          >
            <span className="flex items-center gap-1.5"><Sparkles size={14} className="text-brand" /> AI solution suggestions</span>
          </SectionTitle>
          {!suggestions && !suggesting && <p className="text-sm text-muted">Let the model read every active alert and recommend reorder / 86 / monitor. Apply from each alert below.</p>}
          {suggesting && <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>}
          {suggestions && (
            <ul className="space-y-1.5">
              {suggestions.map((s) => (
                <li key={s.alertId} className="flex items-start gap-2 text-sm">
                  <Badge tone={s.recommended === 'eighty_six' ? 'danger' : s.recommended === 'reorder' ? 'brand' : 'neutral'}>
                    {s.recommended === 'reorder' ? 'Reorder' : s.recommended === 'eighty_six' ? '86' : 'Monitor'}
                  </Badge>
                  <span className="text-muted"><b className="text-text">{s.ingredient}</b> — {s.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card>
        <SectionTitle
          right={
            <div className="flex items-center gap-2">
              {cart.data && cart.data.count > 0 && <Badge tone="brand">cart: {cart.data.count}</Badge>}
              <div className="flex gap-1 rounded-xl bg-surface-2 p-1">
                {(['ACTIVE', 'RESOLVED'] as const).map((f) => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${filter === f ? 'bg-brand text-brand-fg' : 'text-muted hover:text-text'}`}>
                    {f === 'ACTIVE' ? 'Active' : 'Resolved'}
                  </button>
                ))}
              </div>
            </div>
          }
        >
          Stock &amp; expiry alerts
        </SectionTitle>

        {alerts.loading ? (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : alerts.data!.length === 0 ? (
          <div className="grid place-items-center py-12 text-center">
            <CheckCircle2 size={32} className="text-ok" />
            <p className="mt-2 text-sm text-muted">No {filter.toLowerCase()} alerts.</p>
          </div>
        ) : (
          <motion.ul variants={stagger} initial="initial" animate="animate" className="space-y-2">
            <AnimatePresence>
              {alerts.data!.map((a) => (
                <AlertRow key={a.id} a={a} active={filter === 'ACTIVE'} onChanged={refetchAll} />
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
      </Card>
    </div>
  );
}

function AlertRow({ a, active, onChanged }: { a: Alert; active: boolean; onChanged: () => void }) {
  const isExpiry = a.type === 'EXPIRY';
  const doNotUse = isExpiry && a.severity === 'critical';
  const [busy, setBusy] = useState<string | null>(null);
  const [showSub, setShowSub] = useState(false);
  const [subOpts, setSubOpts] = useState<SubOption[] | null>(null);
  // Classification tells us whether to offer secondary-ingredient choices.
  const cls = useApi<Classify>(active && !isExpiry ? `/alerts/${a.id}/classify` : '');
  const isOut = (a.currentQuantity ?? 1) <= 0;
  const hasSecondary = (cls.data?.secondaryDishes.length ?? 0) > 0;

  async function run(path: string, body: any = {}) {
    setBusy(path);
    try { await api(`/alerts/${a.id}/${path}`, { method: 'POST', body: JSON.stringify(body) }); onChanged(); }
    finally { setBusy(null); }
  }
  async function openSub() {
    setShowSub(true);
    const opts = await api<SubOption[]>(`/alerts/${a.id}/substitute-options`);
    setSubOpts(opts.slice(0, 12));
  }

  return (
    <motion.li variants={fadeUp} layout exit={{ opacity: 0, x: -20 }}
      className={`rounded-xl border p-3 ${doNotUse ? 'border-danger/50 bg-danger/5' : 'border-border bg-surface-2'}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${a.severity === 'critical' ? 'bg-danger/15 text-danger' : 'bg-warn/15 text-warn'}`}>
          {isExpiry ? <Clock size={18} /> : a.type === 'LOW_STOCK' ? <PackageX size={18} /> : <TriangleAlert size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{a.ingredientName}</span>
            <Badge tone={sevTone[a.severity as keyof typeof sevTone] ?? 'neutral'}>{a.severity}</Badge>
            {isExpiry && <Badge tone="neutral">expiry</Badge>}
            {doNotUse && <Badge tone="danger">DO NOT USE</Badge>}
            {active && !isExpiry && isOut && cls.data?.isEssentialSomewhere && <Badge tone="danger">essential → auto sold-out</Badge>}
          </div>
          <p className="text-sm text-muted">{a.message}</p>
          {active && !isExpiry && isOut && cls.data?.essentialDishes.length ? (
            <p className="mt-0.5 text-xs text-muted">Essential for: {cls.data.essentialDishes.join(', ')}</p>
          ) : null}
        </div>
        {a.currentQuantity !== null && (
          <div className="hidden shrink-0 text-right text-xs text-muted sm:block">
            <div>{num(a.currentQuantity)} {a.unit}</div>
            {a.reorderPoint !== null && <div>reorder {num(a.reorderPoint)}</div>}
          </div>
        )}
        {active && (
          <div className="flex flex-wrap gap-1.5">
            <Button variant="ghost" onClick={() => run('reorder')} disabled={busy !== null}>
              <Truck size={14} /> {busy === 'reorder' ? '…' : 'Add to cart'}
            </Button>
            {/* Secondary-ingredient choices (only when there is a secondary usage) */}
            {hasSecondary && (
              <>
                <Button variant="ghost" onClick={openSub} disabled={busy !== null}><Replace size={14} /> Substitute</Button>
                <Button variant="ghost" onClick={() => run('serve-without')} disabled={busy !== null}>
                  <EyeOff size={14} /> {busy === 'serve-without' ? '…' : 'Serve without'}
                </Button>
              </>
            )}
            {/* 86 is always available (full sell-out) */}
            <Button variant="ghost" onClick={() => run('eighty-six')} disabled={busy !== null}>
              <Ban size={14} /> {busy === 'eighty-six' ? '…' : '86'}
            </Button>
            <Button variant="ghost" onClick={() => run('resolve', { resolution: 'Handled by manager.' })} disabled={busy !== null}>
              {busy === 'resolve' ? '…' : 'Resolve'}
            </Button>
          </div>
        )}
      </div>

      {/* Substitute picker */}
      <AnimatePresence>
        {showSub && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-3 rounded-lg border border-border bg-surface p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">Substitute {a.ingredientName} with…</span>
                <button onClick={() => setShowSub(false)} className="text-xs text-muted hover:text-text">cancel</button>
              </div>
              {cls.data && <p className="mb-2 text-xs text-muted">Applies to secondary use on: {cls.data.secondaryDishes.join(', ')}</p>}
              {!subOpts ? (
                <Skeleton className="h-20 w-full" />
              ) : (
                <div className="grid max-h-56 gap-1.5 overflow-y-auto sm:grid-cols-2">
                  {subOpts.map((o) => (
                    <button key={o.id} disabled={busy !== null}
                      onClick={() => run('substitute', { substituteId: o.id }).then(() => setShowSub(false))}
                      className="flex items-center justify-between rounded-lg glass-inset border border-transparent px-3 py-2 text-left text-sm hover:border-brand/40 disabled:opacity-50">
                      <span>{o.name} <span className="text-xs text-muted">{o.category}</span></span>
                      <span className="text-xs text-muted">{num(o.currentStock)} {o.unit}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}
