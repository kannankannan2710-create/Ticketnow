import { Clock, Lock, Plus, RefreshCw, Trash2, Unlock } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import type { BookingWindow, BookingWindowStatus, Movie, Show, ShowSeatMapResponse } from '../../types';

// MODULE 8: BOOKING OPEN DATE & ADVANCE BOOKING CONTROL
export function AdminBookingScheduleModule({ onDataChanged }: { onDataChanged: () => void }) {
  const [windows, setWindows] = useState<BookingWindow[]>([]);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [shows, setShows] = useState<Show[]>([]);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [form, setForm] = useState({
    scope_type: 'MOVIE' as 'GLOBAL' | 'MOVIE' | 'SHOW',
    scope_id: '',
    booking_open_at: '2026-11-20T10:00',
    booking_close_at: '2026-11-27T23:59',
    advance_enabled: true,
    max_advance_days: 7,
    advance_start_date: '',
    advance_end_date: '',
    status: 'SCHEDULED' as BookingWindowStatus,
    announcement_text: 'Advance booking opens on 20 Nov 2026 at 10:00 AM',
  });

  const load = useCallback(async () => {
    try {
      const [wRes, mRes, sRes] = await Promise.all([
        apiFetch<{ windows: BookingWindow[] }>('/api/admin/booking-windows'),
        apiFetch<{ movies: Movie[] }>('/api/admin/movies'),
        apiFetch<{ shows: Show[] }>('/api/admin/shows'),
      ]);
      setWindows(wRes.windows);
      setMovies(mRes.movies);
      setShows(sRes.shows);
      if (!form.scope_id && mRes.movies[0]) {
        setForm((f) => ({ ...f, scope_id: mRes.movies[0].id }));
      }
    } catch (err) {
      setMsg({ type: 'err', text: (err as Error).message });
    }
  }, [form.scope_id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const scopeId = form.scope_type === 'GLOBAL' ? 'ALL' : form.scope_id;
    try {
      await apiFetch('/api/admin/booking-windows', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          scope_id: scopeId,
          booking_open_at: form.booking_open_at.length === 16 ? `${form.booking_open_at}:00` : form.booking_open_at,
          booking_close_at: form.booking_close_at.length === 16 ? `${form.booking_close_at}:00` : form.booking_close_at,
        }),
      });
      setMsg({ type: 'ok', text: 'Booking window saved & enforced immediately by server validation.' });
      await load();
      onDataChanged();
    } catch (err) {
      setMsg({ type: 'err', text: (err as Error).message });
    }
  };

  const handleQuickEdit = (w: BookingWindow) => {
    setForm({
      scope_type: w.scope_type,
      scope_id: w.scope_id,
      booking_open_at: w.booking_open_at.slice(0, 16),
      booking_close_at: w.booking_close_at.slice(0, 16),
      advance_enabled: w.advance_enabled,
      max_advance_days: w.max_advance_days,
      advance_start_date: w.advance_start_date || '',
      advance_end_date: w.advance_end_date || '',
      status: w.status,
      announcement_text: w.announcement_text || '',
    });
  };

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/api/admin/booking-windows/${id}`, { method: 'DELETE' });
      await load();
      onDataChanged();
    } catch (err) {
      setMsg({ type: 'err', text: (err as Error).message });
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display font-bold text-lg text-slate-950">
          Booking Open Date &amp; Advance Booking Control
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Server-enforced date/time booking gates. Before open time, customers see a live countdown; at open time, booking unlocks automatically.
        </p>
      </div>

      {msg && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-xs font-medium ${
            msg.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Configure Schedule Form */}
      <form onSubmit={handleSave} className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex items-center gap-2 font-display font-bold text-sm text-slate-950">
          <Clock className="w-4 h-4 text-emerald-600" />
          Configure Booking Window &amp; Advance Limit
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="block font-semibold text-slate-600 mb-1">Rule Scope</label>
            <select
              value={form.scope_type}
              onChange={(e) => {
                const st = e.target.value as 'GLOBAL' | 'MOVIE' | 'SHOW';
                setForm({
                  ...form,
                  scope_type: st,
                  scope_id: st === 'GLOBAL' ? 'ALL' : st === 'MOVIE' ? movies[0]?.id || '' : shows[0]?.id || '',
                });
              }}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white"
            >
              <option value="GLOBAL">Global Default</option>
              <option value="MOVIE">Movie-Wise Schedule</option>
              <option value="SHOW">Show-Wise Schedule</option>
            </select>
          </div>

          <div className="lg:col-span-2">
            <label className="block font-semibold text-slate-600 mb-1">Target</label>
            {form.scope_type === 'GLOBAL' ? (
              <input
                type="text"
                disabled
                value="All Movies & Shows (Global Default)"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-500"
              />
            ) : form.scope_type === 'MOVIE' ? (
              <select
                value={form.scope_id}
                onChange={(e) => setForm({ ...form, scope_id: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white"
              >
                {movies.length === 0 ? (
                  <option value="">No Movies Added Yet</option>
                ) : (
                  movies.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title} ({m.status})
                    </option>
                  ))
                )}
              </select>
            ) : (
              <select
                value={form.scope_id}
                onChange={(e) => setForm({ ...form, scope_id: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white"
              >
                {shows.length === 0 ? (
                  <option value="">No Shows Scheduled Yet</option>
                ) : (
                  shows.slice(0, 60).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.movie_title} · {s.show_date} {s.start_time} ({s.theatre_logo_code})
                    </option>
                  ))
                )}
              </select>
            )}
          </div>

          <div>
            <label className="block font-semibold text-slate-600 mb-1">Booking Status</label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as BookingWindowStatus })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-semibold"
            >
              <option value="OPEN">OPEN</option>
              <option value="SCHEDULED">SCHEDULED</option>
              <option value="CLOSED">CLOSED</option>
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-600 mb-1">Booking Open Date &amp; Time</label>
            <input
              type="datetime-local"
              required
              value={form.booking_open_at}
              onChange={(e) => setForm({ ...form, booking_open_at: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-600 mb-1">Booking Close Date &amp; Time</label>
            <input
              type="datetime-local"
              required
              value={form.booking_close_at}
              onChange={(e) => setForm({ ...form, booking_close_at: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-600 mb-1">Advance Start Date</label>
            <input
              type="date"
              value={form.advance_start_date}
              onChange={(e) => setForm({ ...form, advance_start_date: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-600 mb-1">Advance End Date</label>
            <input
              type="date"
              value={form.advance_end_date}
              onChange={(e) => setForm({ ...form, advance_end_date: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-600 mb-1">Max Advance Days</label>
            <input
              type="number"
              min={1}
              max={60}
              value={form.max_advance_days}
              onChange={(e) => setForm({ ...form, max_advance_days: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono"
            />
          </div>

          <div className="flex items-end pb-2">
            <label className="inline-flex items-center gap-2 font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={form.advance_enabled}
                onChange={(e) => setForm({ ...form, advance_enabled: e.target.checked })}
              />
              Advance Booking Enabled
            </label>
          </div>

          <div className="sm:col-span-2">
            <label className="block font-semibold text-slate-600 mb-1">Customer Announcement Banner Text</label>
            <input
              type="text"
              value={form.announcement_text}
              onChange={(e) => setForm({ ...form, announcement_text: e.target.value })}
              placeholder="Advance bookings open for shows on Friday"
              className="w-full px-3 py-2 rounded-lg border border-slate-200"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
          >
            <Plus className="w-4 h-4" />
            Save Booking Schedule
          </button>
        </div>
      </form>

      {/* Active Windows Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-2.5 px-4 font-semibold">Scope &amp; Target</th>
                <th className="py-2.5 px-4 font-semibold">Open Window</th>
                <th className="py-2.5 px-4 font-semibold">Advance Policy</th>
                <th className="py-2.5 px-4 font-semibold">Status</th>
                <th className="py-2.5 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {windows.map((w) => (
                <tr key={w.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-950">{w.scope_label}</div>
                    <div className="text-[11px] text-slate-400 font-mono">{w.scope_type}</div>
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-700">
                    <div>Opens: {w.booking_open_at.replace('T', ' ')}</div>
                    <div className="text-slate-400">Closes: {w.booking_close_at.replace('T', ' ')}</div>
                  </td>
                  <td className="py-3 px-4 text-slate-600">
                    {w.advance_enabled ? `Enabled · up to ${w.max_advance_days} days` : 'Same-day only'}
                    {w.advance_start_date && (
                      <div className="text-[11px] font-mono text-slate-400">
                        {w.advance_start_date} → {w.advance_end_date || '∞'}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4 font-semibold">
                    <span
                      className={
                        w.status === 'OPEN'
                          ? 'text-emerald-700'
                          : w.status === 'SCHEDULED'
                          ? 'text-amber-700'
                          : 'text-rose-700'
                      }
                    >
                      {w.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleQuickEdit(w)}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-xs font-semibold mr-1.5"
                    >
                      Edit
                    </button>
                    {w.scope_type !== 'GLOBAL' && (
                      <button
                        type="button"
                        onClick={() => handleDelete(w.id)}
                        className="p-1.5 rounded-lg hover:bg-rose-100 text-rose-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
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

// MODULE 9: LIVE SEAT AVAILABILITY & SHOW-SPECIFIC SEAT BLOCKING
export function AdminSeatAvailabilityModule({ onDataChanged }: { onDataChanged: () => void }) {
  const [shows, setShows] = useState<Show[]>([]);
  const [selectedShowId, setSelectedShowId] = useState('');
  const [seatMap, setSeatMap] = useState<ShowSeatMapResponse | null>(null);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [reason, setReason] = useState('VIP / Management Hold');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadShows = useCallback(async () => {
    const res = await apiFetch<{ shows: Show[] }>('/api/admin/shows');
    setShows(res.shows);
    if (!selectedShowId && res.shows[0]) {
      setSelectedShowId(res.shows[0].id);
    }
  }, [selectedShowId]);

  const loadSeatMap = useCallback(async (showId: string) => {
    if (!showId) return;
    const res = await apiFetch<ShowSeatMapResponse>(`/api/shows/${showId}/seat-map`);
    setSeatMap(res);
    setPickedIds([]);
  }, []);

  useEffect(() => {
    loadShows();
  }, [loadShows]);

  useEffect(() => {
    if (selectedShowId) loadSeatMap(selectedShowId);
  }, [selectedShowId, loadSeatMap]);

  const togglePick = (seatId: string) => {
    setPickedIds((prev) => (prev.includes(seatId) ? prev.filter((x) => x !== seatId) : [...prev, seatId]));
  };

  const pickEntireRow = (rowLabel: string) => {
    if (!seatMap) return;
    const rowSeats = seatMap.seats.filter((s) => s.row === rowLabel && s.status !== 'OCCUPIED').map((s) => s.id);
    const allPicked = rowSeats.every((id) => pickedIds.includes(id));
    if (allPicked) {
      setPickedIds((prev) => prev.filter((id) => !rowSeats.includes(id)));
    } else {
      setPickedIds((prev) => Array.from(new Set([...prev, ...rowSeats])));
    }
  };

  const applySeatAction = async (action: 'BLOCK' | 'UNBLOCK') => {
    if (!selectedShowId || pickedIds.length === 0) return;
    setMsg(null);
    try {
      const res = await apiFetch<{ message: string }>(`/api/admin/shows/${selectedShowId}/block-seats`, {
        method: 'POST',
        body: JSON.stringify({ seat_ids: pickedIds, action, reason }),
      });
      setMsg({ type: 'ok', text: res.message });
      await loadSeatMap(selectedShowId);
      onDataChanged();
    } catch (err) {
      setMsg({ type: 'err', text: (err as Error).message });
    }
  };

  const releaseLocks = async (forceAll: boolean) => {
    if (!selectedShowId) return;
    try {
      const res = await apiFetch<{ message: string }>(`/api/admin/shows/${selectedShowId}/release-locks`, {
        method: 'POST',
        body: JSON.stringify({ force_all: forceAll }),
      });
      setMsg({ type: 'ok', text: res.message });
      await loadSeatMap(selectedShowId);
      onDataChanged();
    } catch (err) {
      setMsg({ type: 'err', text: (err as Error).message });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-lg text-slate-950">Live Seat Availability &amp; Show-Specific Blocking</h2>
          <p className="text-xs text-slate-500">
            Block or unblock seats/rows for a specific showtime only — never affects other shows on the same screen.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedShowId}
            onChange={(e) => setSelectedShowId(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold max-w-md"
          >
            {shows.length === 0 ? (
              <option value="">No Shows Scheduled Yet</option>
            ) : (
              shows.slice(0, 80).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.show_date} {s.start_time} · {s.movie_title} · {s.theatre_logo_code} ({s.screen_name})
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            disabled={!selectedShowId}
            onClick={() => releaseLocks(false)}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 disabled:opacity-40 text-xs font-semibold"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Release Expired Locks
          </button>
        </div>
      </div>

      {msg && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-xs font-medium ${
            msg.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {msg.text}
        </div>
      )}

      {!seatMap ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
          <p className="font-display font-bold text-sm text-slate-900">No Active Shows Scheduled</p>
          <p className="text-xs text-slate-500 mt-1">
            Add theatres, screens, movies, and shows to inspect live seat availability or block seats.
          </p>
        </div>
      ) : (
        <>
          {/* Live Inventory Counters */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 tabular-nums">
            <div className="rounded-xl border border-slate-200 bg-white p-3.5">
              <div className="text-[11px] text-slate-500">Total Capacity</div>
              <div className="font-mono font-bold text-lg text-slate-950">{seatMap.metrics.total_seats}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3.5">
              <div className="text-[11px] text-slate-500">Available</div>
              <div className="font-mono font-bold text-lg text-emerald-700">{seatMap.metrics.available_seats}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3.5">
              <div className="text-[11px] text-slate-500">Booked</div>
              <div className="font-mono font-bold text-lg text-slate-950">{seatMap.metrics.booked_seats}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3.5">
              <div className="text-[11px] text-slate-500">Admin Blocked</div>
              <div className="font-mono font-bold text-lg text-rose-700">{seatMap.metrics.blocked_seats}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3.5">
              <div className="text-[11px] text-slate-500">Temp Locked</div>
              <div className="font-mono font-bold text-lg text-amber-700">{seatMap.metrics.locked_seats}</div>
            </div>
          </div>

          {/* Selection Action Bar */}
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-600">
              Click individual seats or click any <strong>Row Label (A, B, C...)</strong> to select an entire row. Selected:{' '}
              <strong className="font-mono text-slate-950">{pickedIds.length}</strong>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Block reason"
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs"
              />
              <button
                type="button"
                disabled={pickedIds.length === 0}
                onClick={() => applySeatAction('BLOCK')}
                className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-semibold"
              >
                <Lock className="w-3.5 h-3.5" />
                Block Selected
              </button>
              <button
                type="button"
                disabled={pickedIds.length === 0}
                onClick={() => applySeatAction('UNBLOCK')}
                className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold"
              >
                <Unlock className="w-3.5 h-3.5" />
                Unblock Selected
              </button>
            </div>
          </div>

          {/* Interactive Show Seat Grid Canvas */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 overflow-auto">
            <div
              className="relative bg-white rounded-xl border border-slate-200 mx-auto"
              style={{
                width: Math.round(seatMap.layout.screen_width * 0.85),
                height: Math.round(seatMap.layout.screen_height * 0.85),
              }}
            >
              <div
                className="relative origin-top-left"
                style={{
                  width: seatMap.layout.screen_width,
                  height: seatMap.layout.screen_height,
                  transform: 'scale(0.85)',
                }}
              >
                {/* Clickable Row Labels to select whole row */}
                {seatMap.layout.rows.map((r) => (
                  <button
                    key={r.label}
                    type="button"
                    onClick={() => pickEntireRow(r.label)}
                    title={`Click to select/deselect Row ${r.label}`}
                    style={{ top: r.y + 2, left: 10 }}
                    className="absolute w-7 h-7 rounded bg-slate-100 hover:bg-slate-950 hover:text-white font-mono font-bold text-xs text-slate-700 transition-colors"
                  >
                    {r.label}
                  </button>
                ))}

                {seatMap.seats.map((seat) => {
                  const picked = pickedIds.includes(seat.id);
                  let cls = 'bg-white border-emerald-600 text-slate-900 hover:bg-emerald-50 cursor-pointer';
                  if (picked) {
                    cls = 'bg-purple-600 border-purple-700 text-white ring-2 ring-purple-300 cursor-pointer';
                  } else if (seat.status === 'OCCUPIED') {
                    cls = 'bg-slate-200 border-slate-300 text-slate-500 cursor-not-allowed';
                  } else if (seat.status === 'BLOCKED') {
                    cls = 'bg-slate-800 border-slate-950 text-white cursor-pointer';
                  } else if (seat.status === 'LOCKED') {
                    cls = 'bg-amber-200 border-amber-500 text-amber-900 cursor-pointer';
                  }
                  return (
                    <button
                      key={seat.id}
                      type="button"
                      disabled={seat.status === 'OCCUPIED'}
                      onClick={() => togglePick(seat.id)}
                      title={`${seat.id} · ${seat.status}`}
                      style={{ left: seat.x, top: seat.y, width: seat.width, height: seat.height }}
                      className={`absolute rounded-md border flex items-center justify-center font-mono text-[10px] font-bold ${cls}`}
                    >
                      {seat.status === 'OCCUPIED' ? '×' : seat.status === 'BLOCKED' ? 'BLK' : seat.number}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
