import {
  AlertCircle,
  Ban,
  Download,
  FileSpreadsheet,
  Plus,
  QrCode,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, downloadBulkBookingsReport } from '../../lib/api';
import { formatDateChip, formatINR } from '../../lib/format';
import type { BulkBookingRecord, Movie } from '../../types';
import { BulkTicketConfirmationModal } from './BulkTicketConfirmationModal';

interface AdminBulkBookingHistoryProps {
  onDataChanged: () => void;
  onCreateNew: () => void;
}

export function AdminBulkBookingHistory({
  onDataChanged,
  onCreateNew,
}: AdminBulkBookingHistoryProps) {
  const [records, setRecords] = useState<BulkBookingRecord[]>([]);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterMovieId, setFilterMovieId] = useState('');
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [viewingRecord, setViewingRecord] = useState<BulkBookingRecord | null>(null);

  // Authorized cancellation modal state
  const [cancelTarget, setCancelTarget] = useState<BulkBookingRecord | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelAuthCode, setCancelAuthCode] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      if (filterDate) params.set('date', filterDate);
      if (filterMovieId) params.set('movie_id', filterMovieId);
      const [bulkRes, movRes] = await Promise.all([
        apiFetch<{ bulk_bookings: BulkBookingRecord[] }>(`/api/admin/bulk-bookings?${params.toString()}`),
        apiFetch<{ movies: Movie[] }>('/api/admin/movies'),
      ]);
      setRecords(bulkRes.bulk_bookings);
      setMovies(movRes.movies);
    } catch (err) {
      setFeedback({ type: 'err', text: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, [searchQuery, filterDate, filterMovieId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const kpis = useMemo(() => {
    const confirmed = records.filter((r) => r.booking_status === 'CONFIRMED');
    const cancelled = records.filter((r) => r.booking_status === 'CANCELLED');
    const tickets = confirmed.reduce((s, r) => s + r.total_tickets, 0);
    const revenue = confirmed.reduce((s, r) => s + r.total_amount, 0);
    return {
      total: records.length,
      tickets,
      revenue: Math.round(revenue * 100) / 100,
      cancelled: cancelled.length,
    };
  }, [records]);

  const handleExport = async (format: 'csv' | 'xlsx') => {
    setExporting(format);
    setFeedback(null);
    try {
      await downloadBulkBookingsReport(format, {
        q: searchQuery.trim() || undefined,
        date: filterDate || undefined,
        movie_id: filterMovieId || undefined,
      });
      setFeedback({ type: 'ok', text: `Bulk booking report exported as ${format.toUpperCase()}.` });
    } catch (err) {
      setFeedback({ type: 'err', text: (err as Error).message });
    } finally {
      setExporting(null);
    }
  };

  const handleConfirmCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelTarget) return;
    setCancelling(true);
    setFeedback(null);
    try {
      const res = await apiFetch<{ message: string }>(`/api/admin/bulk-bookings/${cancelTarget.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({
          reason: cancelReason.trim(),
          authorization_code: cancelAuthCode.trim(),
        }),
      });
      setFeedback({ type: 'ok', text: res.message });
      setCancelTarget(null);
      setCancelReason('');
      setCancelAuthCode('');
      await loadHistory();
      onDataChanged();
    } catch (err) {
      setFeedback({ type: 'err', text: (err as Error).message });
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header & Exports */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display font-extrabold text-xl text-slate-950 tracking-tight">
            Bulk Booking History &amp; Management
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Track group reservations, inspect individual QR passes, export reports, and authorize cancellations
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={exporting !== null}
            onClick={() => handleExport('csv')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800"
          >
            <Download className="w-3.5 h-3.5" />
            {exporting === 'csv' ? 'Exporting...' : 'Export CSV'}
          </button>
          <button
            type="button"
            disabled={exporting !== null}
            onClick={() => handleExport('xlsx')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            {exporting === 'xlsx' ? 'Exporting...' : 'Export Excel (.xlsx)'}
          </button>
          <button
            type="button"
            onClick={onCreateNew}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
          >
            <Plus className="w-3.5 h-3.5" />
            New Bulk Booking
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Bulk Orders</div>
          <div className="font-display font-extrabold text-2xl text-slate-950 mt-1 tabular-nums">{kpis.total}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Confirmed Tickets</div>
          <div className="font-display font-extrabold text-2xl text-purple-700 mt-1 tabular-nums">{kpis.tickets}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Confirmed Revenue</div>
          <div className="font-display font-extrabold text-2xl text-emerald-700 mt-1 font-mono tabular-nums">
            {formatINR(kpis.revenue)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Cancelled Batches</div>
          <div className="font-display font-extrabold text-2xl text-slate-700 mt-1 tabular-nums">{kpis.cancelled}</div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Bulk ID, Customer, Mobile, Ref, Ticket..."
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-emerald-600"
          />
        </div>
        <input
          type="date"
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          className="px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-800"
        />
        <select
          value={filterMovieId}
          onChange={(e) => setFilterMovieId(e.target.value)}
          className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-800"
        >
          <option value="">All Movies</option>
          {movies.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
      </div>

      {feedback && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-xs font-medium flex items-center gap-2 ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Records List */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-slate-500">Loading bulk booking history...</div>
        ) : records.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <div className="text-sm font-semibold text-slate-800">No bulk bookings found</div>
            <p className="text-xs text-slate-500">
              Create your first group or corporate bulk booking to generate individual QR tickets and reports.
            </p>
            <button
              type="button"
              onClick={onCreateNew}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              Create Bulk Booking
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Booking ID</th>
                  <th className="px-4 py-3 font-semibold">Customer Details</th>
                  <th className="px-4 py-3 font-semibold">Theatre &amp; Screen</th>
                  <th className="px-4 py-3 font-semibold">Movie &amp; Show</th>
                  <th className="px-4 py-3 font-semibold text-right">Tickets</th>
                  <th className="px-4 py-3 font-semibold text-right">Amount</th>
                  <th className="px-4 py-3 font-semibold">Payment / Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {records.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 align-top">
                      <div className="font-mono font-bold text-slate-950">{r.bulk_code}</div>
                      {r.reference_code && (
                        <div className="font-mono text-[10px] text-slate-500 mt-0.5">Ref: {r.reference_code}</div>
                      )}
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {r.mode === 'MULTIPLE_CUSTOMERS' ? 'Multi-Customer' : 'Single Customer'}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-semibold text-slate-900">{r.primary_customer_name}</div>
                      <div className="font-mono text-[11px] text-slate-500">{r.primary_customer_mobile}</div>
                      {r.customer_count > 1 && (
                        <div className="text-[10px] font-semibold text-purple-700 mt-0.5">
                          +{r.customer_count - 1} other attendee{r.customer_count > 2 ? 's' : ''}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-slate-900 max-w-[200px] truncate">{r.theatre_name}</div>
                      <div className="text-[11px] text-slate-500">{r.screen_name}</div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-semibold text-slate-900">{r.movie_title}</div>
                      <div className="text-[11px] text-slate-500">
                        {formatDateChip(r.show_date).fullLabel} · {r.show_time}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-right">
                      <div className="font-mono font-bold text-slate-950">{r.total_tickets}</div>
                      <div className="font-mono text-[10px] text-slate-400 max-w-[110px] truncate ml-auto">
                        {r.tickets.map((t) => t.seat_id).join(', ')}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-right font-mono font-bold text-slate-950 tabular-nums">
                      {formatINR(r.total_amount)}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div
                        className={`font-semibold ${
                          r.booking_status === 'CONFIRMED' ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {r.booking_status}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {r.payment_status} · {r.payment_method}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setViewingRecord(r)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-800"
                        >
                          <QrCode className="w-3.5 h-3.5 text-emerald-600" />
                          Tickets / PDF
                        </button>
                        {r.booking_status === 'CONFIRMED' && (
                          <button
                            type="button"
                            onClick={() => {
                              setCancelTarget(r);
                              setCancelReason('');
                              setCancelAuthCode('');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-[11px] font-semibold text-rose-700"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* View Tickets / Print / Download PDF Modal */}
      <BulkTicketConfirmationModal record={viewingRecord} onClose={() => setViewingRecord(null)} />

      {/* Authorized Cancellation Modal */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmCancel}
            className="bg-white w-full max-w-md rounded-2xl border border-slate-200 shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2 text-rose-700 font-display font-bold text-base">
                <ShieldAlert className="w-5 h-5" />
                Authorize Bulk Cancellation
              </div>
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3.5 text-xs">
              <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-rose-900">
                Cancelling <strong className="font-mono">{cancelTarget.bulk_code}</strong> will immediately void all{' '}
                <strong>{cancelTarget.total_tickets}</strong> tickets, process a refund of{' '}
                <strong className="font-mono">{formatINR(cancelTarget.total_amount)}</strong>, and release every seat back to available inventory.
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Cancellation Reason *</label>
                <input
                  type="text"
                  required
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Corporate event rescheduled by organizer"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-rose-500"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Type <span className="font-mono font-bold text-rose-700">CANCEL</span> to authorize *
                </label>
                <input
                  type="text"
                  required
                  value={cancelAuthCode}
                  onChange={(e) => setCancelAuthCode(e.target.value)}
                  placeholder="CANCEL"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 font-mono text-xs focus:outline-none focus:border-rose-500"
                />
              </div>
            </div>
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700"
              >
                Keep Booking
              </button>
              <button
                type="submit"
                disabled={cancelling || cancelAuthCode.trim().toUpperCase() !== 'CANCEL'}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold disabled:opacity-40"
              >
                {cancelling ? 'Cancelling...' : 'Authorize & Release Seats'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
