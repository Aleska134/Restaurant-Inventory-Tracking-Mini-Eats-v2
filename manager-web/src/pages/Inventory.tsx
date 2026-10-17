import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ClipboardCheck, X, Lightbulb, Truck } from 'lucide-react';
import { useApi, api } from '../lib/api';
import { num, fmtPacks, baseToPacks, packLabel, money } from '../lib/format';
import { Card, SectionTitle, Skeleton, Badge, Button, stagger, fadeUp } from '../components/ui';

interface Stock {
  id: string; name: string; category: string; unit: string;
  currentStock: number; reorderPoint: number; targetDays: number | null;
  avgDailyUsage: number; daysOfCover: number | null;
  status: 'ok' | 'low' | 'out' | 'overstock';
  packSize: number | null; packLabel: string | null;
}
interface Serving { menuItemId: string; name: string; servingsRemaining: number | null; limitingIngredient: { name: string } | null; }
interface Overstock { ingredient: string; daysOfCover: number; targetDays: number; suggestedDishes: string[]; reason: string; }

const statusTone = { ok: 'ok', low: 'warn', out: 'danger', overstock: 'brand' } as const;
const statusLabel = { ok: 'OK', low: 'Low', out: 'Out', overstock: 'Overstock' } as const;

export function Inventory() {
  const stock = useApi<Stock[]>('/inventory');
  const servings = useApi<Serving[]>('/inventory/servings');
  const overstock = useApi<Overstock[]>('/inventory/overstock');
  const pendingPOs = useApi<{ id: string; vendorName: string; total: number; items: any[] }[]>('/purchase-orders/pending');
  const [counting, setCounting] = useState<Stock | null>(null);

  async function receivePO(id: string) {
    await api(`/purchase-orders/${id}/receive`, { method: 'POST', body: JSON.stringify({}) });
    pendingPOs.refetch(); stock.refetch(); servings.refetch();
  }

  return (
    <div className="space-y-6">
      {/* "Did you receive your order?" prompt for each pending PO */}
      {pendingPOs.data && pendingPOs.data.length > 0 && pendingPOs.data.map((po) => (
        <Card key={po.id} className="border-brand/40">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand/15 text-brand"><Truck size={20} /></span>
              <div>
                <div className="font-semibold">Did you receive the order from {po.vendorName}?</div>
                <div className="text-xs text-muted">{po.items.length} item(s) · {money(po.total)} — confirming adds the stock to inventory.</div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => receivePO(po.id)}>Yes, received — add stock</Button>
              <Button variant="ghost" onClick={() => pendingPOs.refetch()}>Not yet</Button>
            </div>
          </div>
        </Card>
      ))}

      {overstock.data && overstock.data.length > 0 && (
        <Card className="border-brand/40 bg-brand/5">
          <SectionTitle>Overstock special suggestions</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">
            {overstock.data.map((s) => (
              <div key={s.ingredient} className="flex gap-3 rounded-xl border border-border bg-surface p-3">
                <Lightbulb size={18} className="mt-0.5 shrink-0 text-brand" />
                <div>
                  <div className="font-semibold">{s.ingredient}</div>
                  <p className="text-sm text-muted">{s.reason}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <SectionTitle>Servings remaining (constrained by scarcest ingredient)</SectionTitle>
        {servings.loading ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {servings.data!.filter((s) => s.servingsRemaining !== null).sort((a, b) => (a.servingsRemaining ?? 0) - (b.servingsRemaining ?? 0)).map((s) => (
              <div key={s.menuItemId} className="rounded-xl glass-inset border border-transparent p-3">
                <div className="flex items-baseline justify-between">
                  <span className="font-medium">{s.name}</span>
                  <span className={`text-lg font-bold ${(s.servingsRemaining ?? 0) < 20 ? 'text-danger' : 'text-text'}`}>{num(s.servingsRemaining ?? 0)}</span>
                </div>
                {s.limitingIngredient && <p className="text-xs text-muted">limited by {s.limitingIngredient.name}</p>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle right={<span className="text-xs text-muted">By purchase package · estimated, not a verified count</span>}>
          Ingredient stock
        </SectionTitle>
        {stock.loading ? (
          <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-4 font-medium">Ingredient</th>
                  <th className="py-2 pr-4 font-medium">Package</th>
                  <th className="py-2 pr-4 font-medium">In stock</th>
                  <th className="py-2 pr-4 font-medium">Reorder at</th>
                  <th className="py-2 pr-4 font-medium">Days cover</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-2 font-medium text-right">Count</th>
                </tr>
              </thead>
              <motion.tbody variants={stagger} initial="initial" animate="animate">
                {stock.data!.map((s) => {
                  const inStock = fmtPacks(s.currentStock, s);
                  const reorder = fmtPacks(s.reorderPoint, s);
                  const hasPack = !!s.packSize && s.packSize > 1;
                  return (
                    <motion.tr variants={fadeUp} key={s.id} className="border-b border-border/60 last:border-0">
                      <td className="py-2.5 pr-4 font-medium">{s.name}<span className="ml-2 text-xs text-muted">{s.category}</span></td>
                      <td className="py-2.5 pr-4 text-xs text-muted">{hasPack ? `${s.packLabel ?? 'pack'} · ${num(s.packSize!)} ${s.unit}` : `by ${s.unit}`}</td>
                      <td className="py-2.5 pr-4 tabular-nums">
                        {inStock.primary}
                        {inStock.secondary && <span className="ml-1 text-xs text-muted">{inStock.secondary}</span>}
                      </td>
                      <td className="py-2.5 pr-4 tabular-nums text-muted">{reorder.primary}</td>
                      <td className="py-2.5 pr-4 tabular-nums text-muted">{s.daysOfCover ?? '—'}</td>
                      <td className="py-2.5 pr-4"><Badge tone={statusTone[s.status]}>{statusLabel[s.status]}</Badge></td>
                      <td className="py-2.5 pr-2 text-right">
                        <button onClick={() => setCounting(s)} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                          <ClipboardCheck size={14} /> Count
                        </button>
                      </td>
                    </motion.tr>
                  );
                })}
              </motion.tbody>
            </table>
          </div>
        )}
      </Card>

      <AnimatePresence>
        {counting && <CountModal stock={counting} onClose={() => setCounting(null)} onSaved={() => { setCounting(null); stock.refetch(); servings.refetch(); }} />}
      </AnimatePresence>
    </div>
  );
}

function CountModal({ stock, onClose, onSaved }: { stock: Stock; onClose: () => void; onSaved: () => void }) {
  const hasPack = !!stock.packSize && stock.packSize > 1;
  const unitWord = hasPack ? packLabel(stock.packLabel, 2) : stock.unit;
  const currentPacks = hasPack ? baseToPacks(stock.currentStock, stock.packSize) : stock.currentStock;
  const [value, setValue] = useState<string>(String(Math.round(currentPacks * 10) / 10));
  const [saving, setSaving] = useState(false);

  const countedPacks = Number(value);
  // Convert the entered package count back to base units for the API.
  const countedBase = hasPack ? Math.round(countedPacks * (stock.packSize ?? 1)) : countedPacks;
  const deltaBase = countedBase - stock.currentStock;
  const deltaPacks = hasPack ? deltaBase / (stock.packSize ?? 1) : deltaBase;

  async function confirm() {
    setSaving(true);
    try {
      await api(`/inventory/${stock.id}/count`, { method: 'POST', body: JSON.stringify({ countedQuantity: countedBase, confirm: true, note: 'Manager physical count' }) });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="glass glass-strong w-full max-w-md rounded-2xl p-5"
        initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 12 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-lg font-bold">Physical count — {stock.name}</h3>
          <button onClick={onClose} className="text-muted hover:text-text"><X size={18} /></button>
        </div>
        {hasPack && <p className="mb-4 text-xs text-muted">1 {packLabel(stock.packLabel, 1)} = {num(stock.packSize!)} {stock.unit}</p>}
        <label className="text-sm text-muted">Counted quantity ({unitWord})</label>
        <input type="number" step={hasPack ? '0.5' : '1'} value={value} onChange={(e) => setValue(e.target.value)}
          className="mt-1 w-full rounded-xl glass-inset border border-transparent px-3 py-2 text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-brand" autoFocus />
        {hasPack && <p className="mt-1 text-xs text-muted">= {num(countedBase)} {stock.unit}</p>}
        <div className="mt-4 flex items-center justify-between rounded-xl glass-inset border border-transparent px-3 py-2 text-sm">
          <span className="text-muted">Estimated: <b className="text-text">{num(Math.round(currentPacks * 10) / 10)} {unitWord}</b></span>
          <span className={deltaBase === 0 ? 'text-muted' : deltaBase > 0 ? 'text-ok' : 'text-danger'}>
            {deltaBase > 0 ? '+' : ''}{num(Math.round(deltaPacks * 10) / 10)} {unitWord}
          </span>
        </div>
        <p className="mt-3 text-xs text-muted">This adjustment is <b>not saved</b> until you confirm.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm} disabled={saving || Number.isNaN(countedPacks)}>{saving ? 'Saving…' : 'Confirm & save'}</Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
