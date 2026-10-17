import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { useApi } from '../lib/api';
import { money, num, channelLabel, CHANNEL_COLORS } from '../lib/format';
import { Card, SectionTitle, Skeleton } from '../components/ui';

interface Channel { channel: string; orders: number; gross: number; fees: number; net: number; feePct: number; }
interface Dish { key: string; name: string; qty: number; revenue: number; }

export function Sales() {
  const channels = useApi<Channel[]>('/sales/channels');
  const dishes = useApi<Dish[]>('/sales/by-dish');

  const chartData = (channels.data ?? []).map((c) => ({ ...c, label: channelLabel(c.channel) }));

  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle>Gross vs net by channel — the delivery-fee story</SectionTitle>
        {channels.loading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ left: -10, right: 8, top: 8 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'rgb(148 163 184)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'rgb(148 163 184)' }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip content={<Tip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="gross" name="Gross" fill="rgb(245 158 11)" radius={[6, 6, 0, 0]} />
                <Bar dataKey="net" name="Net" fill="rgb(34 197 94)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <th className="py-2 pr-4 font-medium">Channel</th>
                    <th className="py-2 pr-4 font-medium">Orders</th>
                    <th className="py-2 pr-4 font-medium">Gross</th>
                    <th className="py-2 pr-4 font-medium">Fees</th>
                    <th className="py-2 pr-4 font-medium">Net</th>
                    <th className="py-2 pr-4 font-medium">Fee %</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.data!.map((c) => (
                    <tr key={c.channel} className="border-b border-border/60 last:border-0">
                      <td className="py-2.5 pr-4 font-medium">
                        <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: CHANNEL_COLORS[c.channel] }} />
                        {channelLabel(c.channel)}
                      </td>
                      <td className="py-2.5 pr-4 tabular-nums">{num(c.orders)}</td>
                      <td className="py-2.5 pr-4 tabular-nums">{money(c.gross)}</td>
                      <td className="py-2.5 pr-4 tabular-nums text-danger">{c.fees > 0 ? `-${money(c.fees)}` : '—'}</td>
                      <td className="py-2.5 pr-4 tabular-nums font-semibold">{money(c.net)}</td>
                      <td className="py-2.5 pr-4 tabular-nums">{c.feePct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <Card>
        <SectionTitle>Dishes sold (all time)</SectionTitle>
        {dishes.loading ? (
          <div className="space-y-2">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-4 font-medium">Dish</th>
                  <th className="py-2 pr-4 font-medium">Qty sold</th>
                  <th className="py-2 pr-4 font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {dishes.data!.map((d) => (
                  <tr key={d.key} className="border-b border-border/60 last:border-0">
                    <td className="py-2.5 pr-4 font-medium">{d.name}</td>
                    <td className="py-2.5 pr-4 tabular-nums">{num(d.qty)}</td>
                    <td className="py-2.5 pr-4 tabular-nums">{money(d.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Tip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name}>{p.name}: <span className="font-medium">{money(p.value)}</span></div>
      ))}
    </div>
  );
}
