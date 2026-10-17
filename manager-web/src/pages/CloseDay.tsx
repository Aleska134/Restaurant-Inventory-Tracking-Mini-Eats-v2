import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { Sparkles, RefreshCw, FileText, ShoppingCart, DoorOpen, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { money, num, channelLabel } from '../lib/format';
import { Card, SectionTitle, Button, Badge } from '../components/ui';
import { AiCookingLoader } from '../components/AiCookingLoader';

interface Facts {
  businessDate: string; orders: number; grossRevenue: number; netRevenue: number; totalFees: number;
  topDishes: { name: string; qty: number; revenue: number }[];
  channelMix: { channel: string; gross: number; net: number; feePct: number }[];
  lowOrOutIngredients: { name: string; currentStock: number; unit: string }[];
  overstockSpecials: { ingredient: string; suggestedDishes: string[] }[];
}
interface SummaryResp { businessDate: string; summaryText: string; facts: Facts; model: string | null; cached: boolean; closedDay?: string; newDay?: string; advanced?: boolean; }
interface OpenCheck {
  ok: boolean;
  lowOrOut: { id: string; name: string; currentStock: number; unit: string; status: string }[];
  activeAlertCount: number;
  alerts: { id: string; type: string; severity: string; ingredient: string; message: string }[];
}

export function CloseDay() {
  const [resp, setResp] = useState<SummaryResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState<{ closed: string; next: string } | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);
  const [closed, setClosed] = useState<boolean | null>(null); // restaurant open/closed state
  const [openCheck, setOpenCheck] = useState<OpenCheck | null>(null);

  // Read the current open/closed state so the single action button knows which mode to show.
  async function loadStatus() {
    try {
      const s = await api<{ open: boolean; closed: boolean; currentDay: string }>('/status');
      setClosed(s.closed);
    } catch { /* ignore */ }
  }
  useEffect(() => { loadStatus(); }, []);

  // OPEN DAY: no AI. First run the readiness check; if problems, warn and let
  // the manager act (but still allow opening). Then reopen.
  async function openDayAction() {
    setReopening(true); setError(null);
    try {
      const check = await api<OpenCheck>('/open-day/check');
      setOpenCheck(check);
      const r = await api<{ openedDay: string; currentDay: string }>('/open-day', { method: 'POST', body: JSON.stringify({}) });
      setAdvanced(null); setResp(null);
      setClosed(false);
      setPushMsg(`Opened — now on ${r.currentDay}`);
      setTimeout(() => setPushMsg(null), 3500);
    } finally { setReopening(false); }
  }

  async function pushLowStock() {
    setPushing(true);
    try {
      const r = await api<{ added: number }>('/cart/add-low-stock', { method: 'POST', body: JSON.stringify({}) });
      setPushMsg(`Added ${r.added} to cart`);
      setTimeout(() => setPushMsg(null), 3000);
    } finally { setPushing(false); }
  }

  async function run(force = false) {
    setLoading(true); setError(null);
    const startedAt = Date.now();
    const MIN_LOADER_MS = 2600; // let the Thinking→Organizing→Writing stages play through
    try {
      const r = await api<SummaryResp>('/close-day', { method: 'POST', body: JSON.stringify({ force }) });
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_LOADER_MS) await new Promise((res) => setTimeout(res, MIN_LOADER_MS - elapsed));
      setResp(r);
      if (r.advanced && r.closedDay && r.newDay) setAdvanced({ closed: r.closedDay, next: r.newDay });
      setClosed(true); // Close Day also closes the restaurant
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const facts = resp?.facts;

  return (
    <div className="space-y-6">
      <Card className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand/15 text-brand"><Sparkles size={22} /></span>
          <div>
            <h2 className="text-lg font-bold">End-of-day summary</h2>
            <p className="text-sm text-muted">Numbers are computed by code; the model only writes the words.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={pushLowStock} disabled={pushing}><ShoppingCart size={16} /> {pushing ? 'Adding…' : pushMsg ?? 'Push low stock to cart'}</Button>
          {resp && closed && <Button variant="ghost" onClick={() => run(true)} disabled={loading}><RefreshCw size={16} /> Regenerate</Button>}
          {closed ? (
            <Button onClick={openDayAction} disabled={reopening}><DoorOpen size={16} /> {reopening ? 'Opening…' : 'Open day'}</Button>
          ) : (
            <Button onClick={() => run(false)} disabled={loading}><Sparkles size={16} /> {loading ? 'Generating…' : 'Close day & summarize'}</Button>
          )}
        </div>
      </Card>

      {error && <Card className="border-danger/40 text-danger">{error}</Card>}

      {/* Open-day readiness warning (no AI): low/out ingredients + alerts to solve */}
      {openCheck && !openCheck.ok && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-warn/50">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-warn/15 text-warn"><AlertTriangle size={18} /></span>
              <div className="min-w-0 space-y-1.5 text-sm">
                <div className="font-semibold">Heads up before the new day</div>
                {openCheck.activeAlertCount > 0 && (
                  <p className="text-muted">You have <b className="text-text">{openCheck.activeAlertCount} alert{openCheck.activeAlertCount === 1 ? '' : 's'}</b> to solve — handle them in the Alerts tab.</p>
                )}
                {openCheck.lowOrOut.length > 0 && (
                  <div>
                    <p className="text-muted">Take action on {openCheck.lowOrOut.length} ingredient{openCheck.lowOrOut.length === 1 ? '' : 's'}:</p>
                    <ul className="mt-1 flex flex-wrap gap-1.5">
                      {openCheck.lowOrOut.map((i) => (
                        <li key={i.id}>
                          <Badge tone={i.status === 'out' ? 'danger' : 'warn'}>{i.name} · {num(i.currentStock)} {i.unit}</Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="pt-1 text-xs text-muted">The day is open — you can keep serving, but these need attention.</p>
              </div>
              <button onClick={() => setOpenCheck(null)} className="ml-auto text-xs text-muted hover:text-text">Dismiss</button>
            </div>
          </Card>
        </motion.div>
      )}

      {openCheck && openCheck.ok && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-ok/40 text-sm"><span className="font-medium text-ok">All good</span> — no low stock and no open alerts. You're set for the day.</Card>
        </motion.div>
      )}

      {advanced && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-ok/40">
            <div className="flex items-center gap-2 text-sm">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-ok/15 text-ok"><Sparkles size={16} /></span>
              <span><b>{advanced.closed}</b> closed. The system has moved to <b className="text-brand">{advanced.next}</b> — the dashboard now reflects the new business day.</span>
            </div>
          </Card>
        </motion.div>
      )}

      {loading && <AiCookingLoader />}

      {resp && !loading && (
        <div className="grid gap-6 lg:grid-cols-5">
          <motion.div className="lg:col-span-3" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <Card>
              <SectionTitle right={<div className="flex items-center gap-2">
                {resp.cached && <Badge tone="neutral">cached</Badge>}
                <Badge tone="brand">{resp.model ?? 'model'}</Badge>
              </div>}>
                <span className="flex items-center gap-1.5"><FileText size={14} /> Summary — {resp.businessDate}</span>
              </SectionTitle>
              <div className="prose-sm max-w-none space-y-2 text-sm leading-relaxed [&_h1]:text-base [&_strong]:text-text [&_li]:ml-4 [&_li]:list-disc">
                <ReactMarkdown>{resp.summaryText}</ReactMarkdown>
              </div>
            </Card>
          </motion.div>

          <motion.div className="lg:col-span-2" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <Card>
              <SectionTitle>Facts given to the model</SectionTitle>
              {facts && (
                <div className="space-y-3 text-sm">
                  <Row label="Orders" value={num(facts.orders)} />
                  <Row label="Gross" value={money(facts.grossRevenue)} />
                  <Row label="Net" value={money(facts.netRevenue)} />
                  <Row label="Fees" value={money(facts.totalFees)} />
                  <div className="border-t border-border pt-2">
                    <div className="mb-1 text-xs uppercase tracking-wide text-muted">Top dishes</div>
                    {facts.topDishes.slice(0, 3).map((d) => <Row key={d.name} label={d.name} value={`${num(d.qty)} · ${money(d.revenue)}`} />)}
                  </div>
                  {facts.lowOrOutIngredients.length > 0 && (
                    <div className="border-t border-border pt-2">
                      <div className="mb-1 text-xs uppercase tracking-wide text-muted">Low / out</div>
                      {facts.lowOrOutIngredients.map((i) => <Row key={i.name} label={i.name} value={`${num(i.currentStock)} ${i.unit}`} />)}
                    </div>
                  )}
                  {facts.overstockSpecials.length > 0 && (
                    <div className="border-t border-border pt-2">
                      <div className="mb-1 text-xs uppercase tracking-wide text-muted">Overstock specials</div>
                      {facts.overstockSpecials.map((o) => <Row key={o.ingredient} label={o.ingredient} value={o.suggestedDishes[0] ?? ''} />)}
                    </div>
                  )}
                </div>
              )}
            </Card>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate text-muted">{label}</span>
      <span className="shrink-0 font-medium tabular-nums">{value}</span>
    </div>
  );
}
