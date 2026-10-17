import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingCart, Trash2, Truck, Wand2, Store, Mail, Check } from 'lucide-react';
import { useApi, api } from '../lib/api';
import { money, num, baseToPacks, packLabel } from '../lib/format';
import { Card, SectionTitle, Skeleton, Button, Badge, stagger, fadeUp } from '../components/ui';

interface CartItem { id: string; ingredientId: string; ingredientName: string; quantity: number; unit: string; status: string; packSize: number | null; packLabel: string | null; }
interface Cart { items: CartItem[]; count: number; }
interface VendorLine { ingredient: string; packs: number; pricePerPack: number | null; lineTotal: number; available: boolean; }
interface VendorCmp { vendorId: string; vendorName: string; email: string; covered: number; totalItems: number; total: number; lines: VendorLine[]; }
interface PO { id: string; vendorName: string; total: number; emailTo: string | null; emailSubject: string | null; emailBody: string | null; }

export function CartPage({ onNavigate }: { onNavigate?: (t: any) => void }) {
  const cart = useApi<Cart>('/cart');
  const [suggesting, setSuggesting] = useState(false);
  const [aiNotes, setAiNotes] = useState<{ ingredient: string; recommendedPacks: number; unit: string; rationale: string }[] | null>(null);
  const [aiModel, setAiModel] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [compare, setCompare] = useState<VendorCmp[] | null>(null);
  const [comparing, setComparing] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placedPO, setPlacedPO] = useState<PO | null>(null);

  async function remove(ingredientId: string) { await api(`/cart/${ingredientId}`, { method: 'DELETE' }); cart.refetch(); setCompare(null); }
  async function setQty(ingredientId: string, quantityBase: number) {
    if (Number.isNaN(quantityBase) || quantityBase <= 0) return;
    await api(`/cart/${ingredientId}/quantity`, { method: 'POST', body: JSON.stringify({ quantity: quantityBase }) });
    cart.refetch(); setCompare(null);
  }
  async function suggestWeek() {
    setSuggesting(true);
    try { await api('/cart/suggest-week', { method: 'POST', body: JSON.stringify({}) }); cart.refetch(); setCompare(null); }
    finally { setSuggesting(false); }
  }
  async function suggestAI() {
    setAiBusy(true);
    try {
      const r = await api<{ model: string; items: { ingredient: string; recommendedPacks: number; unit: string; rationale: string }[] }>('/cart/suggest-ai', { method: 'POST', body: JSON.stringify({}) });
      setAiNotes(r.items); setAiModel(r.model); cart.refetch(); setCompare(null);
    } finally { setAiBusy(false); }
  }
  async function doCompare() {
    setComparing(true);
    try { const r = await api<{ vendors: VendorCmp[] }>('/cart/compare-vendors'); setCompare(r.vendors); }
    finally { setComparing(false); }
  }
  async function placeWith(vendorId: string) {
    setPlacing(true);
    try {
      const po = await api<PO>('/cart/place-with-vendor', { method: 'POST', body: JSON.stringify({ vendorId }) });
      setPlacedPO(po); setCompare(null); cart.refetch();
    } finally { setPlacing(false); }
  }

  const items = cart.data?.items ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle
          right={items.length > 0 ? (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={suggestAI} disabled={aiBusy}><Wand2 size={15} /> {aiBusy ? 'Analyzing…' : 'AI analyze'}</Button>
              <Button variant="ghost" onClick={suggestWeek} disabled={suggesting}><Wand2 size={15} /> {suggesting ? 'Sizing…' : 'Weekly par'}</Button>
              <Button onClick={doCompare} disabled={comparing}><Store size={15} /> {comparing ? 'Comparing…' : 'Place order'}</Button>
            </div>
          ) : undefined}
        >
          <span className="flex items-center gap-1.5"><ShoppingCart size={14} /> Shopping cart — reorders</span>
        </SectionTitle>

        {cart.loading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : items.length === 0 ? (
          <div className="grid place-items-center py-12 text-center">
            <ShoppingCart size={30} className="text-muted opacity-50" />
            <p className="mt-2 text-sm text-muted">Cart is empty. Hit <b>Reorder</b> on an alert, or push suggestions from Close Day.</p>
          </div>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted">“Suggest weekly qty” sizes each item to cover ~7 days of usage. “Place order” compares your vendors.</p>
            <motion.ul variants={stagger} initial="initial" animate="animate" className="space-y-2">
              <AnimatePresence>
                {items.map((it) => {
                  const hasPack = !!it.packSize && it.packSize > 1;
                  const packs = hasPack ? baseToPacks(it.quantity, it.packSize) : it.quantity;
                  const unitWord = hasPack ? packLabel(it.packLabel, 2) : it.unit;
                  return (
                    <motion.li key={it.id} variants={fadeUp} layout exit={{ opacity: 0, x: -20 }}
                      className="flex items-center gap-3 rounded-xl glass-inset border border-transparent p-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">{it.ingredientName}</div>
                        <div className="text-xs text-muted">{hasPack ? `${it.packLabel ?? 'pack'} · ${num(it.packSize!)} ${it.unit} each` : `by ${it.unit}`}</div>
                      </div>
                      <div className="text-right">
                        <input type="number" step="1" defaultValue={Math.round(packs * 10) / 10} key={it.quantity}
                          onBlur={(e) => { const p = Number(e.target.value); setQty(it.ingredientId, hasPack ? Math.round(p * (it.packSize ?? 1)) : p); }}
                          className="w-24 rounded-lg glass-inset border border-transparent px-2 py-1.5 text-right text-sm tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-brand" />
                        {hasPack && <div className="mt-0.5 text-[10px] text-muted">≈ {num(it.quantity)} {it.unit}</div>}
                      </div>
                      <span className="w-14 text-xs text-muted">{unitWord}</span>
                      <button onClick={() => remove(it.ingredientId)} className="text-muted hover:text-danger"><Trash2 size={16} /></button>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </motion.ul>
          </>
        )}
      </Card>

      {/* AI analysis rationale */}
      <AnimatePresence>
        {aiNotes && aiNotes.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card className="border-brand/30">
              <SectionTitle right={aiModel ? <Badge tone="brand">{aiModel}</Badge> : undefined}>
                <span className="flex items-center gap-1.5"><Wand2 size={14} className="text-brand" /> AI reorder analysis</span>
              </SectionTitle>
              <ul className="space-y-1.5">
                {aiNotes.map((n) => (
                  <li key={n.ingredient} className="flex items-start gap-2 text-sm">
                    <Badge tone="brand">{num(n.recommendedPacks)} {n.unit}</Badge>
                    <span className="text-muted"><b className="text-text">{n.ingredient}</b> — {n.rationale}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Vendor comparison */}
      <AnimatePresence>
        {compare && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card>
              <SectionTitle>Compare vendors — pick who to order from</SectionTitle>
              {compare.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted">No vendors yet. Add one in the Vendors tab.</p>
              ) : (
                <div className="grid gap-3 lg:grid-cols-3">
                  {compare.map((v, i) => (
                    <div key={v.vendorId} className={`rounded-xl border p-3 ${i === 0 ? 'border-brand/50' : 'border-transparent glass-inset'}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{v.vendorName}</span>
                        {i === 0 && <Badge tone="brand">best</Badge>}
                      </div>
                      <div className="mt-1 text-2xl font-bold tabular-nums">{money(v.total)}</div>
                      <div className="text-xs text-muted">covers {v.covered}/{v.totalItems} items</div>
                      <div className="mt-2 space-y-1 text-xs">
                        {v.lines.map((l) => (
                          <div key={l.ingredient} className="flex items-center justify-between">
                            <span className={l.available ? '' : 'text-muted line-through'}>{l.ingredient}</span>
                            <span className="tabular-nums text-muted">{l.available ? `${l.packs}× · ${money(l.lineTotal)}` : 'n/a'}</span>
                          </div>
                        ))}
                      </div>
                      <Button className="mt-3 w-full" variant={i === 0 ? 'primary' : 'ghost'} onClick={() => placeWith(v.vendorId)} disabled={placing || v.covered === 0}>
                        <Mail size={14} /> {placing ? 'Placing…' : 'Order & email'}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Placed confirmation with generated email */}
      <AnimatePresence>
        {placedPO && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card className="border-ok/40">
              <div className="mb-2 flex items-center gap-2"><Check size={18} className="text-ok" /><span className="font-semibold">Order sent to {placedPO.vendorName} — {money(placedPO.total)}</span></div>
              <div className="text-sm"><span className="text-muted">To:</span> {placedPO.emailTo} · <span className="text-muted">Subject:</span> {placedPO.emailSubject}</div>
              <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl glass-inset border border-transparent p-3 text-sm">{placedPO.emailBody}</pre>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => navigator.clipboard?.writeText(placedPO.emailBody ?? '')}>Copy email</Button>
                {onNavigate && <Button onClick={() => onNavigate('vendors')}><Store size={14} /> View in Vendors</Button>}
              </div>
              <p className="mt-2 text-xs text-muted">Stock updates when you confirm receipt — a prompt appears on Inventory while this order is pending.</p>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
