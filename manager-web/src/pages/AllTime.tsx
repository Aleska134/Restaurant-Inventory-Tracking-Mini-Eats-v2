import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts';
import { CalendarRange } from 'lucide-react';
import { useApi } from '../lib/api';
import { money, num, channelLabel, CHANNEL_COLORS } from '../lib/format';
import { Card, SectionTitle, Skeleton, Badge } from '../components/ui';

type DayRow = { businessDate: string; gross: number; net: number; orders: number };
type Dish = { key: string; name: string; qty: number; revenue: number };
type Channel = { channel: string; gross: number; net: number; orders: number; feePct: number };

export function AllTime() {
  const days = useApi<DayRow[]>('/sales/by-day');
  const dishes = useApi<Dish[]>('/sales/by-dish');       // no date = all-time
  const channels = useApi<Channel[]>('/sales/channels');  // no date = all-time

  const trend = (days.data ?? []).map((d) => ({ ...d, label: d.businessDate.slice(5) }));
  const topDishes = (dishes.data ?? []).slice(0, 10);
  const channelMix = channels.data ?? [];

  const totals = (days.data ?? []).reduce(
    (a, d) => ({ gross: a.gross + d.gross, net: a.net + d.net, orders: a.orders + d.orders }),
    { gross: 0, net: 0, orders: 0 }
  );
  const span = days.data?.length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted">
        <CalendarRange size={15} className="text-brand" />
        <span>Lifetime view{span ? ` — ${span} days of history` : ''}</span>
        <Badge tone="neutral">historical</Badge>
      </div>

      {/* Lifetime totals */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><div className="text-sm text-muted">Total orders</div><div className="mt-1 text-3xl font-bold">{days.loading ? '…' : num(totals.orders)}</div></Card>
        <Card><div className="text-sm text-muted">Total gross</div><div className="mt-1 text-3xl font-bold">{days.loading ? '…' : money(totals.gross)}</div></Card>
        <Card><div className="text-sm text-muted">Total net</div><div className="mt-1 text-3xl font-bold">{days.loading ? '…' : money(totals.net)}</div><div className="mt-1 text-xs text-muted">{days.loading ? '' : `${money(totals.gross - totals.net)} in channel fees`}</div></Card>
      </div>

      <Card>
        <SectionTitle>Revenue — full history (gross vs net)</SectionTitle>
        {days.loading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={trend} margin={{ left: -18, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="rgb(245 158 11)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="rgb(245 158 11)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'rgb(148 163 184)' }} interval={6} />
              <YAxis tick={{ fontSize: 11, fill: 'rgb(148 163 184)' }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTip />} />
              <Area type="monotone" dataKey="gross" stroke="rgb(245 158 11)" fill="url(#g1)" strokeWidth={2} name="Gross" />
              <Area type="monotone" dataKey="net" stroke="rgb(34 197 94)" fill="transparent" strokeWidth={2} name="Net" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle>Top dishes (all time)</SectionTitle>
          {dishes.loading ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={topDishes} layout="vertical" margin={{ left: 40, right: 16 }}>
                <XAxis type="number" tick={{ fontSize: 11, fill: 'rgb(148 163 184)' }} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: 'rgb(148 163 184)' }} />
                <Tooltip content={<ChartTip />} />
                <Bar dataKey="qty" fill="rgb(245 158 11)" radius={[0, 6, 6, 0]} name="Sold" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card>
          <SectionTitle>Channel mix (all time)</SectionTitle>
          {channels.loading ? (
            <Skeleton className="h-72 w-full" />
          ) : channelMix.length ? (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={channelMix} dataKey="gross" nameKey="channel" innerRadius={52} outerRadius={84} paddingAngle={3}>
                    {channelMix.map((c) => (
                      <Cell key={c.channel} fill={CHANNEL_COLORS[c.channel] ?? '#888'} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChannelTip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1.5">
                {channelMix.map((c) => (
                  <div key={c.channel} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: CHANNEL_COLORS[c.channel] }} />
                      {channelLabel(c.channel)}
                    </span>
                    <span className="text-muted">{money(c.gross)} · {c.feePct}% fee</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="py-10 text-center text-sm text-muted">No channel data.</p>
          )}
        </Card>
      </div>
    </div>
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
          {p.name}: <span className="font-medium">{typeof p.value === 'number' && p.value > 100 ? money(p.value) : num(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function ChannelTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="font-semibold">{channelLabel(d.channel)}</div>
      <div className="text-muted">{money(d.gross)} gross · {money(d.net)} net</div>
      <div className="text-muted">{d.orders} orders · {d.feePct}% fee</div>
    </div>
  );
}
