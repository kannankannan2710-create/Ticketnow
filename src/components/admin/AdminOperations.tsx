import { Download, Plus, Search, Send, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch, downloadAdminReport } from '../../lib/api';
import { formatINR } from '../../lib/format';
import type {
  AppSettings,
  AuditLog,
  BookingRecord,
  Movie,
  NotificationItem,
  Offer,
  PaymentRecord,
  Theatre,
  UserRole,
} from '../../types';

// MODULE 10: BOOKING MANAGEMENT
export function AdminBookingsModule({ onDataChanged }: { onDataChanged: () => void }) {
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [theatres, setTheatres] = useState<Theatre[]>([]);
  const [q, setQ] = useState('');
  const [movieId, setMovieId] = useState('');
  const [theatreId, setTheatreId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<BookingRecord | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (movieId) params.set('movie_id', movieId);
    if (theatreId) params.set('theatre_id', theatreId);
    if (statusFilter) params.set('booking_status', statusFilter);

    const [bRes, mRes, tRes] = await Promise.all([
      apiFetch<{ bookings: BookingRecord[] }>(`/api/admin/bookings?${params.toString()}`),
      apiFetch<{ movies: Movie[] }>('/api/admin/movies'),
      apiFetch<{ theatres: Theatre[] }>('/api/admin/theatres'),
    ]);
    setBookings(bRes.bookings);
    setMovies(mRes.movies);
    setTheatres(tRes.theatres);
  }, [q, movieId, theatreId, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCancel = async (b: BookingRecord) => {
    try {
      const res = await apiFetch<{ message: string }>(`/api/admin/bookings/${b.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Cancelled via Admin Booking Management' }),
      });
      setMsg(res.message);
      setSelected(null);
      await load();
      onDataChanged();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-lg text-slate-950">Booking Management</h2>
          <p className="text-xs text-slate-500">Search by booking ID, customer name or mobile; inspect immutable price snapshots</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Booking ID, name, mobile..."
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white"
          />
        </div>
        <select value={movieId} onChange={(e) => setMovieId(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white">
          <option value="">All Movies</option>
          {movies.map((m) => (
            <option key={m.id} value={m.id}>{m.title}</option>
          ))}
        </select>
        <select value={theatreId} onChange={(e) => setTheatreId(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white">
          <option value="">All Theatres</option>
          {theatres.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white">
          <option value="">All Statuses</option>
          <option value="CONFIRMED">CONFIRMED</option>
          <option value="CANCELLED">CANCELLED</option>
        </select>
      </div>

      {msg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-900">{msg}</div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-2.5 px-4 font-semibold">Booking ID</th>
                <th className="py-2.5 px-4 font-semibold">Customer</th>
                <th className="py-2.5 px-4 font-semibold">Show Details</th>
                <th className="py-2.5 px-4 font-semibold">Seats</th>
                <th className="py-2.5 px-4 font-semibold text-right">Amount</th>
                <th className="py-2.5 px-4 font-semibold">Payment / Status</th>
                <th className="py-2.5 px-4 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {bookings.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-mono font-bold text-slate-950">{b.booking_code}</td>
                  <td className="py-2.5 px-4">
                    <div className="font-semibold text-slate-900">{b.customer_name}</div>
                    <div className="text-[11px] font-mono text-slate-500">{b.customer_mobile}</div>
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="font-semibold text-slate-900">{b.movie_title}</div>
                    <div className="text-[11px] text-slate-500">
                      {b.theatre_name} · {b.show_date} {b.show_time}
                    </div>
                  </td>
                  <td className="py-2.5 px-4 font-mono text-slate-700 max-w-[160px] truncate">
                    {b.seats.map((s) => s.seat_id).join(', ')} ({b.seat_count})
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-950">{formatINR(b.total_amount)}</td>
                  <td className="py-2.5 px-4">
                    <div className={b.booking_status === 'CONFIRMED' ? 'text-emerald-700 font-semibold' : 'text-rose-600 font-semibold'}>
                      {b.booking_status}
                    </div>
                    <div className="text-[11px] text-slate-400">{b.payment_status}</div>
                  </td>
                  <td className="py-2.5 px-4 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setSelected(b)}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 font-semibold"
                    >
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-display font-bold text-base text-slate-950">{selected.booking_code}</h3>
                <p className="text-xs text-slate-500">{selected.movie_title} · {selected.show_date} {selected.show_time}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="p-1.5 rounded-lg hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs tabular-nums">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-slate-500">Customer:</span> <strong>{selected.customer_name}</strong></div>
                <div><span className="text-slate-500">Mobile:</span> <strong className="font-mono">{selected.customer_mobile}</strong></div>
                <div className="col-span-2"><span className="text-slate-500">Theatre:</span> {selected.theatre_name} ({selected.screen_name})</div>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-1">
                <div className="font-semibold text-slate-700 mb-1">Immutable Seat Price Snapshot</div>
                {selected.seats.map((s) => (
                  <div key={s.seat_id} className="flex justify-between font-mono">
                    <span>{s.seat_id} ({s.category_name})</span>
                    <span>{formatINR(s.unit_price)}</span>
                  </div>
                ))}
                <div className="pt-1.5 border-t border-slate-200 flex justify-between">
                  <span>Convenience Fee + GST</span>
                  <span className="font-mono">{formatINR(selected.convenience_fee + selected.tax_amount)}</span>
                </div>
                {selected.discount_amount > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <span>Promo ({selected.offer_code})</span>
                    <span className="font-mono">−{formatINR(selected.discount_amount)}</span>
                  </div>
                )}
                <div className="pt-1 border-t border-slate-200 flex justify-between font-bold text-slate-950">
                  <span>Total Paid ({selected.payment_gateway || 'Razorpay'})</span>
                  <span className="font-mono">{formatINR(selected.total_amount)}</span>
                </div>
              </div>
              {selected.booking_status === 'CONFIRMED' && (
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => handleCancel(selected)}
                    className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold"
                  >
                    Cancel Booking &amp; Process 75% Refund
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// MODULE 11: CUSTOMER MANAGEMENT
export function AdminCustomersModule() {
  const [customers, setCustomers] = useState<
    Array<{
      id: string;
      name: string;
      email: string;
      mobile: string;
      city: string;
      status: string;
      booking_count: number;
      total_tickets: number;
      total_spent: number;
    }>
  >([]);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    const res = await apiFetch<{ customers: typeof customers }>(`/api/admin/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    setCustomers(res.customers);
  }, [q]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleStatus = async (id: string, cur: string) => {
    await apiFetch(`/api/admin/customers/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: cur === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }),
    });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-lg text-slate-950">Customer Management</h2>
          <p className="text-xs text-slate-500">Customer spending ledger, ticket counts &amp; account access control</p>
        </div>
        <div className="relative w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search customer..."
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-xs"
          />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-2.5 px-4 font-semibold">Customer</th>
                <th className="py-2.5 px-4 font-semibold">Contact &amp; City</th>
                <th className="py-2.5 px-4 font-semibold text-right">Bookings</th>
                <th className="py-2.5 px-4 font-semibold text-right">Tickets</th>
                <th className="py-2.5 px-4 font-semibold text-right">Total Spent</th>
                <th className="py-2.5 px-4 font-semibold text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {customers.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-semibold text-slate-950">{c.name}</td>
                  <td className="py-3 px-4 text-slate-600">
                    <div>{c.mobile} · {c.city}</div>
                    <div className="text-[11px] text-slate-400">{c.email}</div>
                  </td>
                  <td className="py-3 px-4 text-right font-mono">{c.booking_count}</td>
                  <td className="py-3 px-4 text-right font-mono">{c.total_tickets}</td>
                  <td className="py-3 px-4 text-right font-mono font-bold text-emerald-700">{formatINR(c.total_spent)}</td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => toggleStatus(c.id, c.status)}
                      className={`font-semibold ${c.status === 'ACTIVE' ? 'text-emerald-700' : 'text-rose-600'}`}
                    >
                      {c.status}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// MODULE 12: PAYMENTS LEDGER
export function AdminPaymentsModule() {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [status, setStatus] = useState('');

  useEffect(() => {
    apiFetch<{ payments: PaymentRecord[] }>(`/api/admin/payments${status ? `?status=${status}` : ''}`).then((r) =>
      setPayments(r.payments)
    );
  }, [status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-lg text-slate-950">Payment Management</h2>
          <p className="text-xs text-slate-500">Server-verified transactions, payment gateways &amp; refund tracking</p>
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs">
          <option value="">All Payment Statuses</option>
          {['SUCCESS', 'PENDING', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-2.5 px-4 font-semibold">Transaction ID</th>
                <th className="py-2.5 px-4 font-semibold">Booking / Customer</th>
                <th className="py-2.5 px-4 font-semibold">Gateway / Method</th>
                <th className="py-2.5 px-4 font-semibold text-right">Amount</th>
                <th className="py-2.5 px-4 font-semibold">Status</th>
                <th className="py-2.5 px-4 font-semibold text-right">Refund</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {payments.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-mono font-semibold text-slate-950">{p.transaction_id}</td>
                  <td className="py-3 px-4">
                    <div className="font-mono font-semibold text-slate-800">{p.booking_code}</div>
                    <div className="text-[11px] text-slate-500">{p.customer_name} · {p.movie_title}</div>
                  </td>
                  <td className="py-3 px-4 text-slate-600">{p.gateway} · {p.method}</td>
                  <td className="py-3 px-4 text-right font-mono font-bold text-slate-950">{formatINR(p.amount)}</td>
                  <td className="py-3 px-4 font-semibold text-emerald-700">{p.status}</td>
                  <td className="py-3 px-4 text-right font-mono text-slate-600">
                    {p.refund_amount > 0 ? `${formatINR(p.refund_amount)} (${p.refund_status})` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// MODULE 13: OFFERS & PROMOTIONS
export function AdminOffersModule({ onDataChanged }: { onDataChanged: () => void }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    subtitle: 'TICKETNOW OFFER',
    description: '',
    banner_url: '/src/assets/images/promo_banner_atmos_1794932274876.jpg',
    cta_label: 'Apply Offer',
    coupon_code: '',
    discount_type: 'FLAT' as 'FLAT' | 'PERCENT',
    discount_value: 75,
    min_booking_amount: 250,
    max_discount: 150,
    start_date: new Date().toISOString().slice(0, 10),
    expiry_date: '2026-12-31',
  });

  const load = useCallback(async () => {
    const res = await apiFetch<{ offers: Offer[] }>('/api/admin/offers');
    setOffers(res.offers);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await apiFetch('/api/admin/offers', { method: 'POST', body: JSON.stringify(form) });
      setForm({ ...form, title: '', description: '', coupon_code: '' });
      setMsg('Offer banner published to Customer Movies Home carousel.');
      await load();
      onDataChanged();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  const toggleActive = async (o: Offer) => {
    await apiFetch(`/api/admin/offers/${o.id}`, {
      method: 'PUT',
      body: JSON.stringify({ is_active: !o.is_active }),
    });
    await load();
    onDataChanged();
  };

  const remove = async (id: string) => {
    await apiFetch(`/api/admin/offers/${id}`, { method: 'DELETE' });
    await load();
    onDataChanged();
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display font-bold text-lg text-slate-950">Offers &amp; Home Banners</h2>
        <p className="text-xs text-slate-500">Manage customer home carousel banners and server-validated promo coupon codes</p>
      </div>

      {msg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-900">{msg}</div>}

      <form onSubmit={handleCreate} className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div>
          <label className="block font-semibold text-slate-600 mb-1">Offer Headline</label>
          <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Flat ₹75 Off Weekday Shows" className="w-full px-3 py-2 rounded-lg border border-slate-200" />
        </div>
        <div>
          <label className="block font-semibold text-slate-600 mb-1">Coupon Code</label>
          <input required value={form.coupon_code} onChange={(e) => setForm({ ...form, coupon_code: e.target.value.toUpperCase() })} placeholder="WEEKDAY75" className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono uppercase" />
        </div>
        <div>
          <label className="block font-semibold text-slate-600 mb-1">Banner Image</label>
          <select value={form.banner_url} onChange={(e) => setForm({ ...form, banner_url: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white">
            <option value="/src/assets/images/promo_banner_atmos_1794932274876.jpg">Dolby Atmos Auditorium</option>
            <option value="/src/assets/images/promo_banner_club_1794932276860.jpg">Cinema Lounge &amp; Popcorn</option>
          </select>
        </div>
        <div>
          <label className="block font-semibold text-slate-600 mb-1">Discount Type &amp; Value</label>
          <div className="flex gap-1.5">
            <select value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value as 'FLAT' | 'PERCENT' })} className="px-2 py-2 rounded-lg border border-slate-200 bg-white">
              <option value="FLAT">Flat ₹</option>
              <option value="PERCENT">Percent %</option>
            </select>
            <input type="number" value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: Number(e.target.value) })} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 font-mono" />
          </div>
        </div>
        <div>
          <label className="block font-semibold text-slate-600 mb-1">Min Booking / Max Discount (₹)</label>
          <div className="flex gap-1.5">
            <input type="number" value={form.min_booking_amount} onChange={(e) => setForm({ ...form, min_booking_amount: Number(e.target.value) })} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 font-mono" />
            <input type="number" value={form.max_discount} onChange={(e) => setForm({ ...form, max_discount: Number(e.target.value) })} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 font-mono" />
          </div>
        </div>
        <div>
          <label className="block font-semibold text-slate-600 mb-1">Expiry Date</label>
          <input type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono" />
        </div>
        <div className="sm:col-span-2">
          <label className="block font-semibold text-slate-600 mb-1">Description</label>
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Valid on 2+ tickets across Tenkasi screens." className="w-full px-3 py-2 rounded-lg border border-slate-200" />
        </div>
        <div className="flex items-end">
          <button type="submit" className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
            <Plus className="w-4 h-4" />
            Publish Offer Banner
          </button>
        </div>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {offers.map((o) => (
          <div key={o.id} className="rounded-xl border border-slate-200 bg-white p-4 flex items-start justify-between gap-3">
            <div className="space-y-1 text-xs">
              <div className="font-display font-bold text-sm text-slate-950">{o.title}</div>
              <div className="font-mono font-bold text-emerald-700">
                Code: {o.coupon_code} · {o.discount_type === 'PERCENT' ? `${o.discount_value}%` : formatINR(o.discount_value)} off
              </div>
              <div className="text-slate-500">Min {formatINR(o.min_booking_amount)} · Valid till {o.expiry_date}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => toggleActive(o)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                  o.is_active ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : 'border-slate-200 text-slate-400'
                }`}
              >
                {o.is_active ? 'Active' : 'Paused'}
              </button>
              <button type="button" onClick={() => remove(o.id)} className="p-1.5 rounded-lg hover:bg-rose-100 text-rose-600">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// MODULE 14: NOTIFICATIONS
export function AdminNotificationsModule({ onDataChanged }: { onDataChanged: () => void }) {
  const [list, setList] = useState<NotificationItem[]>([]);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState<NotificationItem['type']>('MOVIE_ANNOUNCEMENT');
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch<{ notifications: NotificationItem[] }>('/api/admin/notifications');
    setList(res.notifications);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/admin/notifications', {
      method: 'POST',
      body: JSON.stringify({ title, message, type, channel: 'IN_APP' }),
    });
    setTitle('');
    setMessage('');
    setFeedback('Broadcast sent to customer notification feed.');
    await load();
    onDataChanged();
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display font-bold text-lg text-slate-950">Notification Management</h2>
        <p className="text-xs text-slate-500">Broadcast booking opening alerts, new releases &amp; special cinema offers</p>
      </div>
      {feedback && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-900">{feedback}</div>}
      <form onSubmit={send} className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div>
          <label className="block font-semibold text-slate-600 mb-1">Notification Type</label>
          <select value={type} onChange={(e) => setType(e.target.value as NotificationItem['type'])} className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white">
            <option value="BOOKING_OPENING">Booking Opening Alert</option>
            <option value="MOVIE_ANNOUNCEMENT">Movie Announcement</option>
            <option value="NEW_RELEASE">New Movie Release</option>
            <option value="SPECIAL_OFFER">Special Offer</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="block font-semibold text-slate-600 mb-1">Title</label>
          <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bookings Now Open for Weekend Shows!" className="w-full px-3 py-2 rounded-lg border border-slate-200" />
        </div>
        <div className="sm:col-span-2">
          <label className="block font-semibold text-slate-600 mb-1">Message</label>
          <input required value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Reserve Platinum & Gold seats for upcoming weekend shows." className="w-full px-3 py-2 rounded-lg border border-slate-200" />
        </div>
        <div className="flex items-end">
          <button type="submit" className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-white font-semibold">
            <Send className="w-3.5 h-3.5" />
            Send Broadcast
          </button>
        </div>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
        {list.map((n) => (
          <div key={n.id} className="p-4 flex items-start justify-between gap-3 text-xs">
            <div>
              <div className="font-semibold text-slate-950">{n.title}</div>
              <p className="text-slate-600 mt-0.5">{n.message}</p>
            </div>
            <span className="font-mono text-[11px] text-slate-400 shrink-0">{n.type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// MODULE 15: REPORTS & ANALYTICS (REAL CSV & EXCEL EXPORT)
const REPORT_TYPES = [
  { id: 'daily', label: 'Daily Collection' },
  { id: 'weekly', label: 'Weekly Collection' },
  { id: 'monthly', label: 'Monthly Collection' },
  { id: 'movie', label: 'Movie-Wise Collection' },
  { id: 'theatre', label: 'Theatre-Wise Collection' },
  { id: 'screen', label: 'Screen-Wise Collection' },
  { id: 'show', label: 'Show-Wise Collection' },
  { id: 'category', label: 'Category-Wise Collection' },
  { id: 'booking', label: 'Booking Report' },
  { id: 'cancellation', label: 'Cancellation Report' },
  { id: 'payment', label: 'Payment Report' },
];

export function AdminReportsModule() {
  const [type, setType] = useState('movie');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ type });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const res = await apiFetch<{ rows: Array<Record<string, unknown>> }>(`/api/admin/reports?${params.toString()}`);
    setRows(res.rows);
  }, [type, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const handleExport = async (fmt: 'csv' | 'xlsx') => {
    setExporting(true);
    try {
      await downloadAdminReport(type, fmt, from || undefined, to || undefined);
    } finally {
      setExporting(false);
    }
  };

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-lg text-slate-950">Reports &amp; Analytics</h2>
          <p className="text-xs text-slate-500">Live SQLite collection ledgers with instant CSV and Excel (.xlsx) export</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-mono" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-mono" />
          <button
            type="button"
            disabled={exporting}
            onClick={() => handleExport('csv')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={() => handleExport('xlsx')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
          >
            <Download className="w-3.5 h-3.5" />
            Export Excel (.xlsx)
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {REPORT_TYPES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setType(r.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 border ${
              type === r.id ? 'bg-slate-950 text-white border-slate-950' : 'bg-white text-slate-700 border-slate-200'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">No report rows available for the selected range.</div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  {columns.map((c) => (
                    <th key={c} className="py-2.5 px-4 font-semibold whitespace-nowrap">
                      {c.replace(/_/g, ' ')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {rows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    {columns.map((c) => (
                      <td key={c} className="py-2.5 px-4 text-slate-800 whitespace-nowrap font-mono">
                        {String(row[c] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// MODULE 16: ADMIN USERS & AUDIT LOGS
export function AdminUsersModule() {
  const [admins, setAdmins] = useState<
    Array<{
      id: string;
      name: string;
      email: string;
      mobile: string;
      role: UserRole;
      assigned_theatre_name?: string | null;
      status: string;
    }>
  >([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [theatres, setTheatres] = useState<Theatre[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    email: '',
    mobile: '+91 98421 00000',
    password: '',
    role: 'THEATRE_ADMIN' as UserRole,
    assigned_theatre_id: '',
  });

  const load = useCallback(async () => {
    const [uRes, tRes] = await Promise.all([
      apiFetch<{ admins: typeof admins; audit_logs: AuditLog[] }>('/api/admin/users'),
      apiFetch<{ theatres: Theatre[] }>('/api/admin/theatres'),
    ]);
    setAdmins(uRes.admins);
    setLogs(uRes.audit_logs);
    setTheatres(tRes.theatres);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await apiFetch('/api/admin/users', { method: 'POST', body: JSON.stringify(form) });
      setForm({ ...form, name: '', email: '', password: '' });
      setMsg('Admin user provisioned.');
      load();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  const toggleStatus = async (id: string, cur: string) => {
    try {
      await apiFetch(`/api/admin/users/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: cur === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }),
      });
      load();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display font-bold text-lg text-slate-950">Admin Users, RBAC &amp; Audit History</h2>
        <p className="text-xs text-slate-500">Super Admin, Theatre Admin, Booking Manager &amp; Accountant access control</p>
      </div>
      {msg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-900">{msg}</div>}

      <form onSubmit={handleCreate} className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
        <input required placeholder="Full Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="px-3 py-2 rounded-lg border border-slate-200" />
        <input required type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="px-3 py-2 rounded-lg border border-slate-200" />
        <input required type="password" placeholder="Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="px-3 py-2 rounded-lg border border-slate-200" />
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })} className="px-3 py-2 rounded-lg border border-slate-200 bg-white">
          <option value="SUPER_ADMIN">SUPER_ADMIN</option>
          <option value="THEATRE_ADMIN">THEATRE_ADMIN</option>
          <option value="BOOKING_MANAGER">BOOKING_MANAGER</option>
          <option value="ACCOUNTANT">ACCOUNTANT</option>
        </select>
        <select
          disabled={form.role !== 'THEATRE_ADMIN'}
          value={form.assigned_theatre_id}
          onChange={(e) => setForm({ ...form, assigned_theatre_id: e.target.value })}
          className="px-3 py-2 rounded-lg border border-slate-200 bg-white disabled:opacity-40"
        >
          <option value="">Assign Theatre...</option>
          {theatres.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <button type="submit" className="py-2 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
          Add Admin
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
            <tr>
              <th className="py-2.5 px-4 font-semibold">Admin</th>
              <th className="py-2.5 px-4 font-semibold">Role</th>
              <th className="py-2.5 px-4 font-semibold">Assigned Scope</th>
              <th className="py-2.5 px-4 font-semibold text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {admins.map((a) => (
              <tr key={a.id}>
                <td className="py-2.5 px-4">
                  <div className="font-semibold text-slate-950">{a.name}</div>
                  <div className="text-[11px] text-slate-400">{a.email}</div>
                </td>
                <td className="py-2.5 px-4 font-mono font-semibold text-slate-800">{a.role}</td>
                <td className="py-2.5 px-4 text-slate-600">{a.assigned_theatre_name || 'Global'}</td>
                <td className="py-2.5 px-4 text-right">
                  <button type="button" onClick={() => toggleStatus(a.id, a.status)} className={`font-semibold ${a.status === 'ACTIVE' ? 'text-emerald-700' : 'text-rose-600'}`}>
                    {a.status}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 font-display font-bold text-sm text-slate-950">
          Admin Activity Audit Log
        </div>
        <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto text-xs">
          {logs.map((l) => (
            <div key={l.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
              <div>
                <span className="font-semibold text-slate-950">{l.admin_name}</span>{' '}
                <span className="text-slate-500">({l.admin_role})</span> ·{' '}
                <span className="font-mono font-semibold text-emerald-700">{l.action}</span>{' '}
                <span className="text-slate-500">on {l.entity_type} {l.entity_id}</span>
              </div>
              <span className="font-mono text-[11px] text-slate-400 shrink-0">{l.created_at}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// MODULE 17: GLOBAL SETTINGS
export function AdminSettingsModule({ onDataChanged }: { onDataChanged: () => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ settings: AppSettings }>('/api/admin/settings').then((r) => setSettings(r.settings));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    const res = await apiFetch<{ settings: AppSettings; message: string }>('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
    setSettings(res.settings);
    setMsg(res.message);
    onDataChanged();
  };

  if (!settings) return <div className="text-xs text-slate-500 p-4">Loading settings...</div>;

  return (
    <form onSubmit={handleSave} className="space-y-5 max-w-3xl">
      <div>
        <h2 className="font-display font-bold text-lg text-slate-950">Global Application Settings</h2>
        <p className="text-xs text-slate-500">Convenience fees, GST tax rates, lock timeout &amp; customer legal policies</p>
      </div>
      {msg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-900">{msg}</div>}
      <div className="rounded-xl border border-slate-200 bg-white p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
        <div>
          <label className="block font-semibold text-slate-700 mb-1">App Name</label>
          <input value={settings.app_name} onChange={(e) => setSettings({ ...settings, app_name: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
        </div>
        <div>
          <label className="block font-semibold text-slate-700 mb-1">Default Currency</label>
          <input value={settings.currency} onChange={(e) => setSettings({ ...settings, currency: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-sm" />
        </div>
        <div>
          <label className="block font-semibold text-slate-700 mb-1">Convenience Fee per Seat (₹)</label>
          <input type="number" step="0.5" value={settings.convenience_fee_per_seat} onChange={(e) => setSettings({ ...settings, convenience_fee_per_seat: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-sm" />
        </div>
        <div>
          <label className="block font-semibold text-slate-700 mb-1">Tax / GST Rate (%)</label>
          <input type="number" step="0.5" value={settings.tax_rate_percent} onChange={(e) => setSettings({ ...settings, tax_rate_percent: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-sm" />
        </div>
        <div>
          <label className="block font-semibold text-slate-700 mb-1">Contact Email</label>
          <input value={settings.contact_email} onChange={(e) => setSettings({ ...settings, contact_email: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
        </div>
        <div>
          <label className="block font-semibold text-slate-700 mb-1">Support Phone</label>
          <input value={settings.contact_phone} onChange={(e) => setSettings({ ...settings, contact_phone: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
        </div>
        <div>
          <label className="block font-semibold text-slate-700 mb-1">Support Hours</label>
          <input value={settings.support_hours} onChange={(e) => setSettings({ ...settings, support_hours: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
        </div>
        <div>
          <label className="block font-semibold text-slate-700 mb-1">Seat Lock Duration (seconds)</label>
          <input type="number" min={60} value={settings.lock_duration_seconds} onChange={(e) => setSettings({ ...settings, lock_duration_seconds: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-sm" />
        </div>
        <div className="sm:col-span-2">
          <label className="block font-semibold text-slate-700 mb-1">Cancellation Policy</label>
          <textarea rows={2} value={settings.cancellation_policy} onChange={(e) => setSettings({ ...settings, cancellation_policy: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
        </div>
        <div className="sm:col-span-2">
          <label className="block font-semibold text-slate-700 mb-1">Terms &amp; Conditions</label>
          <textarea rows={2} value={settings.terms_text} onChange={(e) => setSettings({ ...settings, terms_text: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
        </div>
        <div className="sm:col-span-2">
          <label className="block font-semibold text-slate-700 mb-1">Privacy Policy</label>
          <textarea rows={2} value={settings.privacy_text} onChange={(e) => setSettings({ ...settings, privacy_text: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
        </div>
      </div>
      <button type="submit" className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold">
        Save Global Settings
      </button>
    </form>
  );
}
