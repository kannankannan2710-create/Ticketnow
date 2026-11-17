import { Calendar, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiFetch } from '../../lib/api';
import { formatINR, getIndicatorMeta } from '../../lib/format';
import type { Show } from '../../types';

interface DashboardPayload {
  kpis: {
    total_theatres: number;
    total_screens: number;
    total_movies: number;
    now_showing_movies: number;
    upcoming_movies: number;
    todays_shows: number;
    total_bookings: number;
    todays_tickets_sold: number;
    todays_revenue: number;
    range_bookings: number;
    range_tickets: number;
    range_revenue: number;
    total_seats: number;
    available_seats: number;
    occupied_seats: number;
    blocked_seats: number;
  };
  charts: {
    daily_revenue: Array<{ date: string; bookings: number; tickets: number; revenue: number }>;
    movie_collections: Array<{ id: string; title: string; bookings: number; tickets: number; revenue: number }>;
    theatre_collections: Array<{ id: string; name: string; logo_code: string; bookings: number; tickets: number; revenue: number }>;
    screen_occupancy: Array<{ screen: string; theatre: string; total: number; booked: number; blocked: number; occupancy_pct: number }>;
  };
  upcoming_shows: Show[];
  date_range: { from: string; to: string; range: string };
}

const RANGES = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: 'Last 7 Days' },
  { id: '30d', label: 'Last 30 Days' },
  { id: 'custom', label: 'Custom' },
];

export function AdminDashboard({ onNavigate }: { onNavigate: (moduleId: string) => void }) {
  const [range, setRange] = useState('7d');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ range });
      if (range === 'custom' && fromDate && toDate) {
        params.set('from', fromDate);
        params.set('to', toDate);
      }
      const res = await apiFetch<DashboardPayload>(`/api/admin/dashboard?${params.toString()}`);
      if (res && res.kpis) {
        setData(res);
      } else {
        setData(null);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [range, fromDate, toDate]);

  useEffect(() => {
    if (range !== 'custom' || (fromDate && toDate)) {
      load();
    }
  }, [load, range, fromDate, toDate]);

  const k = data?.kpis;
  const dailyRevenue = data?.charts?.daily_revenue ?? [];
  const movieCollections = data?.charts?.movie_collections ?? [];
  const theatreCollections = data?.charts?.theatre_collections ?? [];
  const screenOccupancy = data?.charts?.screen_occupancy ?? [];
  const upcomingShows = data?.upcoming_shows ?? [];
  const dateRange = data?.date_range;

  return (
    <div className="space-y-6">
      {/* Date Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl p-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                range === r.id
                  ? 'bg-slate-950 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {r.label}
            </button>
          ))}
          {range === 'custom' && (
            <div className="flex items-center gap-2 ml-1">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-mono"
              />
              <span className="text-xs text-slate-400">to</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-mono"
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {dateRange?.from && dateRange?.to && (
            <span className="text-xs text-slate-500 font-mono hidden sm:inline">
              {dateRange.from} → {dateRange.to}
            </span>
          )}
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
      )}

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500 font-medium">Range Revenue</div>
          <div className="font-mono font-bold text-xl sm:text-2xl text-emerald-700 mt-1 tabular-nums">
            {k ? formatINR(k.range_revenue) : '—'}
          </div>
          <div className="text-xs text-slate-500 mt-1 tabular-nums">
            Today: {k ? formatINR(k.todays_revenue) : '—'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500 font-medium">Total Confirmed Bookings</div>
          <div className="font-mono font-bold text-xl sm:text-2xl text-slate-950 mt-1 tabular-nums">
            {k ? k.total_bookings.toLocaleString('en-IN') : '—'}
          </div>
          <div className="text-xs text-slate-500 mt-1 tabular-nums">
            Today sold: {k ? k.todays_tickets_sold : 0} tickets
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500 font-medium">Today&apos;s Live Seat Inventory</div>
          <div className="font-mono font-bold text-xl sm:text-2xl text-slate-950 mt-1 tabular-nums">
            {k ? k.available_seats.toLocaleString('en-IN') : '—'}{' '}
            <span className="text-xs font-normal text-slate-400">/ {k ? k.total_seats : 0}</span>
          </div>
          <div className="text-xs text-slate-500 mt-1 tabular-nums">
            {k ? `${k.occupied_seats} occupied · ${k.blocked_seats} blocked` : '—'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500 font-medium">Cinema Footprint</div>
          <div className="font-mono font-bold text-xl sm:text-2xl text-slate-950 mt-1 tabular-nums">
            {k ? `${k.total_theatres} / ${k.total_screens}` : '—'}
          </div>
          <div className="text-xs text-slate-500 mt-1 tabular-nums">
            {k ? `${k.now_showing_movies} Now Showing · ${k.upcoming_movies} Upcoming · ${k.todays_shows} Shows today` : '—'}
          </div>
        </div>
      </div>

      {/* Analytics Charts Row */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Daily Revenue Trend */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-display font-bold text-sm text-slate-950">Revenue &amp; Booking Trend</h2>
                <p className="text-xs text-slate-500">Confirmed collections in INR</p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
              >
                Export CSV / Excel
              </button>
            </div>
            {dailyRevenue.length === 0 ? (
              <div className="h-60 flex items-center justify-center text-xs text-slate-500">
                No confirmed bookings in the selected date range yet.
              </div>
            ) : (
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyRevenue}>
                    <defs>
                      <linearGradient id="tnRevFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#16A34A" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#16A34A" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748B' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                    <Tooltip
                      formatter={(val: unknown) => [formatINR(Number(val)), 'Revenue']}
                      contentStyle={{ borderRadius: 10, borderColor: '#E2E8F0', fontSize: 12 }}
                    />
                    <Area type="monotone" dataKey="revenue" stroke="#16A34A" strokeWidth={2.2} fill="url(#tnRevFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {/* Movie-wise Collections */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-display font-bold text-sm text-slate-950">Movie-Wise Collections</h2>
                <p className="text-xs text-slate-500">Gross revenue per movie across all theatres</p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('movies')}
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
              >
                Manage Movies
              </button>
            </div>
            {movieCollections.length === 0 ? (
              <div className="h-60 flex flex-col items-center justify-center text-center gap-1.5">
                <p className="font-display font-semibold text-sm text-slate-800">No Movies Added Yet</p>
                <p className="text-xs text-slate-500">Add movies in Movie Management to view collections here.</p>
              </div>
            ) : (
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={movieCollections}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis
                      dataKey="title"
                      tick={{ fontSize: 10, fill: '#64748B' }}
                      tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)}
                    />
                    <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                    <Tooltip
                      formatter={(val: unknown) => [formatINR(Number(val)), 'Revenue']}
                      contentStyle={{ borderRadius: 10, borderColor: '#E2E8F0', fontSize: 12 }}
                    />
                    <Bar dataKey="revenue" fill="#0F172A" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {/* Theatre-wise Collections */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-display font-bold text-sm text-slate-950">Theatre-Wise Collections</h2>
                <p className="text-xs text-slate-500">Ticket volume and revenue by cinema property</p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('theatres')}
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
              >
                Manage Theatres
              </button>
            </div>
            {theatreCollections.length === 0 ? (
              <div className="py-8 text-center space-y-1">
                <p className="font-display font-semibold text-sm text-slate-800">No Theatres Added Yet</p>
                <p className="text-xs text-slate-500">Add theatres in Theatre Management to track revenue here.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {theatreCollections.map((t) => {
                  const maxRev = Math.max(1, ...theatreCollections.map((x) => x.revenue));
                  const pct = Math.round((t.revenue / maxRev) * 100);
                  return (
                    <div key={t.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-900 truncate pr-3">{t.name}</span>
                        <span className="font-mono font-semibold text-slate-950 tabular-nums shrink-0">
                          {formatINR(t.revenue)} · {t.tickets} tix
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full bg-emerald-600 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Screen-wise Occupancy */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="mb-4">
              <h2 className="font-display font-bold text-sm text-slate-950">Today&apos;s Screen-Wise Occupancy</h2>
              <p className="text-xs text-slate-500">Excludes admin-blocked seats from sellable capacity</p>
            </div>
            {screenOccupancy.length === 0 ? (
              <p className="text-xs text-slate-500 py-8 text-center">No active shows scheduled today.</p>
            ) : (
              <div className="space-y-3">
                {screenOccupancy.map((s, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-900 truncate">{s.screen}</span>
                      <span className="font-mono text-slate-600 tabular-nums">
                        {s.occupancy_pct}% ({s.booked}/{s.total} sellable · {s.blocked} blocked)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          s.occupancy_pct >= 75 ? 'bg-amber-500' : 'bg-slate-900'
                        }`}
                        style={{ width: `${Math.min(100, s.occupancy_pct)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Upcoming Shows Table */}
      {data && (
        <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-emerald-600" />
              <h2 className="font-display font-bold text-sm text-slate-950">Upcoming Active Shows</h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('shows')}
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
            >
              Manage Shows
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Show Date &amp; Time</th>
                  <th className="py-2.5 px-4 font-semibold">Movie</th>
                  <th className="py-2.5 px-4 font-semibold">Theatre / Screen</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Available</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Booked / Blocked</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {upcomingShows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      No upcoming active shows scheduled yet.
                    </td>
                  </tr>
                ) : (
                  upcomingShows.map((sh) => {
                    const m = sh.metrics;
                    const ind = getIndicatorMeta(m?.indicator || 'AVAILABLE');
                    return (
                      <tr key={sh.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 font-mono text-slate-800 whitespace-nowrap">
                          {sh.show_date} · {sh.start_time}
                        </td>
                        <td className="py-2.5 px-4 font-semibold text-slate-950">{sh.movie_title}</td>
                        <td className="py-2.5 px-4 text-slate-600">
                          {sh.theatre_name} · {sh.screen_name}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-semibold text-emerald-700">
                          {m?.available_seats ?? 0}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-slate-600">
                          {m?.booked_seats ?? 0} / {m?.blocked_seats ?? 0}
                        </td>
                        <td className={`py-2.5 px-4 text-right font-semibold whitespace-nowrap ${ind.textClass}`}>
                          {ind.label}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
