import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Store, Plus, Trash2, Mail, PackageCheck, Clock, X, Tag } from 'lucide-react';
import { useApi, api } from '../lib/api';
import { money, num } from '../lib/format';
import { Card, SectionTitle, Skeleton, Badge, Button, stagger, fadeUp } from '../components/ui';

type Relationship = 'local' | 'regional' | 'corporate';
interface VendorProduct { id: string; ingredientId: string; ingredientName: string; pricePerPack: number; packLabel: string | null; }
interface Vendor { id: string; name: string; email: string; phone: string | null; relationship: Relationship; productCount: number; products?: VendorProduct[]; }
interface POItem { ingredientName: string; packs: number; packSize: number; unit: string; pricePerPack: number; lineTotal: number; }
interface PO { id: string; vendorName: string; status: string; total: number; emailTo: string | null; emailSubject: string | null; emailBody: string | null; createdAt: string; items: POItem[]; }
interface InvItem { id: string; name: string; unit: string; packLabel?: string | null; }

const REL_LABEL: Record<Relationship, string> = { local: 'Local', regional: 'Regional', corporate: 'Corporate' };
const REL_TONE: Record<Relationship, 'ok' | 'neutral' | 'warn'> = { local: 'ok', regional: 'neutral', corporate: 'warn' };

export function Vendors() {
  const vendors = useApi<Vendor[]>('/vendors');
  const orders = useApi<PO[]>('/purchase-orders');
  const inventory = useApi<InvItem[]>('/inventory');
  const [adding, setAdding] = useState(false);
  const [viewPO, setViewPO] = useState<PO | null>(null);
  const [manageVendor, setManageVendor] = useState<Vendor | null>(null); // vendor whose product drawer is open
  const [form, setForm] = useState<{ name: string; email: string; phone: string; relationship: Relationship }>({ name: '', email: '', phone: '', relationship: 'regional' });
  const [saving, setSaving] = useState(false);

  async function addVendor() {
    if (!form.name || !form.email) return;
    setSaving(true);
    try {
      await api('/vendors', { method: 'POST', body: JSON.stringify(form) });
      setForm({ name: '', email: '', phone: '', relationship: 'regional' }); setAdding(false); vendors.refetch();
    } finally { setSaving(false); }
  }
  async function remove(id: string) { await api(`/vendors/${id}`, { method: 'DELETE' }); vendors.refetch(); }
  async function receive(id: string) { await api(`/purchase-orders/${id}/receive`, { method: 'POST', body: JSON.stringify({}) }); orders.refetch(); vendors.refetch(); }

  return (
    <div className="space-y-6">
      {/* Vendors */}
      <Card>
        <SectionTitle right={<Button variant="ghost" onClick={() => setAdding((a) => !a)}><Plus size={15} /> Add provider</Button>}>
          <span className="flex items-center gap-1.5"><Store size={14} /> Vendors</span>
        </SectionTitle>

        <AnimatePresence>
          {adding && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="mb-4 grid gap-2 rounded-xl glass-inset border border-transparent p-3 sm:grid-cols-5">
                <input placeholder="Vendor name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="rounded-lg glass-inset border border-transparent px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand" />
                <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="rounded-lg glass-inset border border-transparent px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand" />
                <input placeholder="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="rounded-lg glass-inset border border-transparent px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand" />
                <select value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value as Relationship })}
                  className="rounded-lg glass-inset border border-transparent px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  title="Relationship sets the voice of the AI-written purchase-order email">
                  <option value="local">Local (warm, personal)</option>
                  <option value="regional">Regional (professional)</option>
                  <option value="corporate">Corporate (formal)</option>
                </select>
                <Button onClick={addVendor} disabled={saving || !form.name || !form.email}>{saving ? 'Saving…' : 'Save vendor'}</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {vendors.loading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : vendors.data!.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">No vendors yet. Add one with “Add provider”.</p>
        ) : (
          <motion.div variants={stagger} initial="initial" animate="animate" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {vendors.data!.map((v) => (
              <motion.div key={v.id} variants={fadeUp} className="rounded-xl glass-inset border border-transparent p-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <div className="font-semibold">{v.name}</div>
                    <div className="truncate text-xs text-muted">{v.email}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <Badge tone={REL_TONE[v.relationship] ?? 'neutral'}>{REL_LABEL[v.relationship] ?? 'Regional'}</Badge>
                      <Badge tone="neutral">{v.productCount} products</Badge>
                    </div>
                  </div>
                  <button onClick={() => remove(v.id)} className="text-muted hover:text-danger"><Trash2 size={15} /></button>
                </div>
                <button onClick={() => setManageVendor(v)}
                  className="mt-2 flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                  <Tag size={12} /> Manage products
                </button>
              </motion.div>
            ))}
          </motion.div>
        )}
      </Card>

      {/* Purchase orders */}
      <Card>
        <SectionTitle>Purchase orders</SectionTitle>
        {orders.loading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : orders.data!.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">No orders yet. Place one from the Cart.</p>
        ) : (
          <ul className="space-y-2">
            {orders.data!.map((po) => (
              <li key={po.id} className="flex flex-wrap items-center gap-3 rounded-xl glass-inset border border-transparent p-3">
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${po.status === 'received' ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn'}`}>
                  {po.status === 'received' ? <PackageCheck size={18} /> : <Clock size={18} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{po.vendorName}</span>
                    <Badge tone={po.status === 'received' ? 'ok' : 'warn'}>{po.status}</Badge>
                  </div>
                  <div className="text-xs text-muted">{po.items.length} item(s) · {money(po.total)} · {new Date(po.createdAt).toLocaleString()}</div>
                </div>
                <Button variant="ghost" onClick={() => setViewPO(po)}><Mail size={14} /> Email</Button>
                {po.status === 'sent' && <Button onClick={() => receive(po.id)}><PackageCheck size={14} /> Mark received</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <AnimatePresence>
        {viewPO && (
          <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setViewPO(null)}>
            <motion.div className="glass glass-strong w-full max-w-lg rounded-2xl p-5" initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 12 }}
              transition={{ type: 'spring', stiffness: 300, damping: 26 }} onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-bold">Order email — {viewPO.vendorName}</h3>
                <button onClick={() => setViewPO(null)} className="text-muted hover:text-text"><X size={18} /></button>
              </div>
              <div className="space-y-1 text-sm">
                <div><span className="text-muted">To:</span> {viewPO.emailTo}</div>
                <div><span className="text-muted">Subject:</span> {viewPO.emailSubject}</div>
              </div>
              <pre className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-xl glass-inset border border-transparent p-3 text-sm">{viewPO.emailBody}</pre>
              <div className="mt-3 flex justify-end">
                <Button variant="ghost" onClick={() => navigator.clipboard?.writeText(viewPO.emailBody ?? '')}>Copy email</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Product-management slide-in drawer */}
      <AnimatePresence>
        {manageVendor && (
          <motion.div className="fixed inset-0 z-50 flex justify-end bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setManageVendor(null)}>
            <motion.aside
              className="glass glass-strong h-full w-full max-w-md overflow-y-auto p-5"
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-1 flex items-start justify-between">
                <div className="min-w-0">
                  <h3 className="truncate text-lg font-bold">{manageVendor.name}</h3>
                  <p className="truncate text-xs text-muted">{manageVendor.email}</p>
                  <div className="mt-1"><Badge tone={REL_TONE[manageVendor.relationship] ?? 'neutral'}>{REL_LABEL[manageVendor.relationship] ?? 'Regional'}</Badge></div>
                </div>
                <button onClick={() => setManageVendor(null)} className="text-muted hover:text-text"><X size={18} /></button>
              </div>
              <VendorProducts vendor={manageVendor} inventory={inventory.data ?? []} onChange={() => vendors.refetch()} />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}



/** Attach the ingredients a vendor sells, each with a price per pack. Checkbox
 *  multi-select: tick ingredients, a price field appears for each, save all at
 *  once. Existing products can be deleted. Backend: POST .../products/batch and
 *  DELETE .../products/:ingredientId. */
function VendorProducts({ vendor, inventory, onChange }: { vendor: Vendor; inventory: InvItem[]; onChange: () => void }) {
  const [saving, setSaving] = useState(false);
  const [list, setList] = useState<VendorProduct[]>(vendor.products ?? []);
  // checked ingredientId -> price string
  const [picked, setPicked] = useState<Record<string, string>>({});

  async function refreshProducts() {
    const all = await api<Vendor[]>('/vendors');
    const mine = all.find((x) => x.id === vendor.id);
    setList(mine?.products ?? []);
    onChange();
  }

  function toggle(id: string) {
    setPicked((p) => {
      if (id in p) { const { [id]: _, ...rest } = p; return rest; }
      return { ...p, [id]: '' };
    });
  }
  function setPrice(id: string, v: string) { setPicked((p) => ({ ...p, [id]: v })); }

  const rows = Object.entries(picked)
    .map(([ingredientId, price]) => ({ ingredientId, pricePerPack: Number(price) }))
    .filter((r) => r.pricePerPack > 0);
  const anyChecked = Object.keys(picked).length > 0;
  const allPriced = anyChecked && rows.length === Object.keys(picked).length;

  async function saveAll() {
    if (!rows.length) return;
    setSaving(true);
    try {
      await api(`/vendors/${vendor.id}/products/batch`, { method: 'POST', body: JSON.stringify({ products: rows }) });
      setPicked({});
      await refreshProducts();
    } finally { setSaving(false); }
  }

  async function removeProduct(ingredientId: string) {
    await api(`/vendors/${vendor.id}/products/${ingredientId}`, { method: 'DELETE' });
    await refreshProducts();
  }

  // Ingredients not already priced for this vendor.
  const taken = new Set(list.map((p) => p.ingredientId));
  const options = inventory.filter((i) => !taken.has(i.id));

  return (
    <div className="mt-4 space-y-5">
      {/* Current products */}
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Products this vendor sells</div>
        {list.length === 0 ? (
          <p className="rounded-lg glass-inset border border-transparent px-3 py-3 text-sm text-muted">No products yet. Pick ingredients below and set a price per pack.</p>
        ) : (
          <ul className="space-y-1.5">
            {list.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg glass-inset border border-transparent px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{p.ingredientName}</span>
                  {p.packLabel ? <span className="text-muted"> · {p.packLabel}</span> : null}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold">{money(p.pricePerPack)}/pack</span>
                  <button onClick={() => removeProduct(p.ingredientId)} title="Remove product" className="text-muted hover:text-danger"><Trash2 size={15} /></button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add new products via checkboxes */}
      {options.length === 0 ? (
        <p className="text-sm text-muted">Every ingredient is already priced for this vendor.</p>
      ) : (
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Add ingredients this vendor sells</div>
          <div className="space-y-1 rounded-lg glass-inset border border-transparent p-2">
            {options.map((i) => {
              const checked = i.id in picked;
              return (
                <div key={i.id} className={`flex items-center gap-3 rounded-md px-2 py-1.5 ${checked ? 'bg-brand/8' : ''}`}>
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-sm">
                    <input type="checkbox" checked={checked} onChange={() => toggle(i.id)}
                      className="h-4 w-4 accent-[var(--brand,#6366f1)]" />
                    <span className="min-w-0">
                      <span className="font-medium">{i.name}</span>
                      {i.packLabel ? <span className="text-muted"> ({i.packLabel})</span> : null}
                    </span>
                  </label>
                  {checked && (
                    <input type="number" min="0" step="0.01" inputMode="decimal" placeholder="$/pack" value={picked[i.id]}
                      onChange={(e) => setPrice(i.id, e.target.value)} autoFocus
                      className="w-28 rounded-md glass-inset border border-transparent px-2.5 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand" />
                  )}
                </div>
              );
            })}
          </div>
          {anyChecked && (
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-muted">{rows.length} of {Object.keys(picked).length} selected have a price</span>
              <Button onClick={saveAll} disabled={saving || !allPriced}>
                <Plus size={14} /> {saving ? 'Saving…' : `Save ${rows.length || ''}`.trim()}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
