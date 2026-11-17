import { Calendar, QrCode, Ticket, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BookingRecord } from '../../types';
import { apiFetch, getGuestBookingCodes } from '../../lib/api';
import { formatDateChip, formatINR } from '../../lib/format';
import { MoviePosterImage, TicketQrCode } from '../BrandMark';

interface BookingsPageProps {
  refreshSignal: number;
  onBrowseMovies: () => void;
}

export function BookingsPage({ refreshSignal, onBrowseMovies }: BookingsPageProps) {
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [tab, setTab] = useState<'UPCOMING' | 'PREVIOUS'>('UPCOMING');
  const [loading, setLoading] = useState(true);
  const [activeQrBooking, setActiveQrBooking] = useState<BookingRecord | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadBookings = useCallback(async () => {
    setLoading(true);
    try {
      const codes = getGuestBookingCodes().join(',');
      const res = await apiFetch<{ bookings: BookingRecord[] }>(
        `/api/bookings${codes ? `?codes=${encodeURIComponent(codes)}` : ''}`
      );
      setBookings(res.bookings);
    } catch {
      setBookings([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBookings();
  }, [loadBookings, refreshSignal]);

  const todayStr = new Date().toISOString().slice(0, 10);

  const { upcomingList, previousList } = useMemo(() => {
    const up: BookingRecord[] = [];
    const prev: BookingRecord[] = [];
    for (const b of bookings) {
      if (b.booking_status === 'CONFIRMED' && b.show_date >= todayStr) {
        up.push(b);
      } else {
        prev.push(b);
      }
    }
    return { upcomingList: up, previousList: prev };
  }, [bookings, todayStr]);

  const visibleList = tab === 'UPCOMING' ? upcomingList : previousList;

  const handleCancel = async (b: BookingRecord) => {
    setCancellingId(b.id);
    setFeedback(null);
    try {
      const res = await apiFetch<{ message: string }>(`/api/bookings/${b.id}/cancel`, {
        method: 'POST',
      });
      setFeedback(res.message);
      await loadBookings();
    } catch (err) {
      setFeedback((err as Error).message);
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-5 pb-24 md:pb-12 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display font-bold text-xl sm:text-2xl text-slate-950 tracking-tight">My Bookings</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Digital cinema passes with verified QR entry codes
          </p>
        </div>

        <div className="inline-flex p-1 rounded-xl bg-slate-100 border border-slate-200 self-start">
          <button
            type="button"
            onClick={() => setTab('UPCOMING')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              tab === 'UPCOMING' ? 'bg-white text-slate-950 shadow-xs' : 'text-slate-600 hover:text-slate-950'
            }`}
          >
            Upcoming ({upcomingList.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('PREVIOUS')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              tab === 'PREVIOUS' ? 'bg-white text-slate-950 shadow-xs' : 'text-slate-600 hover:text-slate-950'
            }`}
          >
            Previous ({previousList.length})
          </button>
        </div>
      </div>

      {feedback && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs sm:text-sm text-emerald-900">
          {feedback}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((n) => (
            <div key={n} className="h-40 rounded-2xl border border-slate-200 bg-slate-50 animate-pulse" />
          ))}
        </div>
      ) : visibleList.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-10 text-center space-y-3">
          <Ticket className="w-8 h-8 text-slate-400 mx-auto" />
          <p className="font-display font-bold text-base text-slate-900">
            {tab === 'UPCOMING' ? 'No upcoming movie tickets' : 'No previous bookings yet'}
          </p>
          <p className="text-sm text-slate-500">Book seats for a live show to see your instant QR pass here.</p>
          <button
            type="button"
            onClick={onBrowseMovies}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
          >
            Browse Now Showing
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {visibleList.map((b) => {
            const chip = formatDateChip(b.show_date);
            const isCancelled = b.booking_status === 'CANCELLED';
            return (
              <article
                key={b.id}
                className="rounded-2xl border border-slate-200 bg-white overflow-hidden"
              >
                <div className="p-4 sm:p-5 flex gap-4">
                  <div className="w-20 sm:w-24 aspect-[3/4] rounded-xl overflow-hidden border border-slate-200 shrink-0 bg-slate-100">
                    <MoviePosterImage
                      src={b.movie_poster}
                      alt={b.movie_title}
                      title={b.movie_title}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-display font-bold text-base sm:text-lg text-slate-950 truncate">
                        {b.movie_title}
                      </h2>
                      <span
                        className={`text-xs font-semibold whitespace-nowrap shrink-0 ${
                          isCancelled ? 'text-rose-600' : 'text-emerald-700'
                        }`}
                      >
                        {isCancelled ? 'Cancelled' : 'Confirmed'}
                      </span>
                    </div>

                    <p className="text-xs text-slate-600 truncate">
                      {b.theatre_name} · Screen {b.screen_number} ({b.screen_name})
                    </p>

                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-700 pt-0.5 tabular-nums">
                      <span className="inline-flex items-center gap-1 font-medium">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        {chip.weekdayShort}, {chip.fullLabel} · {b.show_time}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 pt-1 tabular-nums">
                      <span>
                        Booking ID: <strong className="font-mono text-slate-900">{b.booking_code}</strong>
                      </span>
                      <span>·</span>
                      <span>
                        Seats ({b.seat_count}):{' '}
                        <strong className="font-mono text-slate-900">
                          {b.seats.map((s) => s.seat_id).join(', ')}
                        </strong>
                      </span>
                      <span>·</span>
                      <span className="font-mono font-bold text-slate-950">{formatINR(b.total_amount)}</span>
                    </div>
                  </div>
                </div>

                <div className="px-4 sm:px-5 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">
                    {b.seats
                      .reduce((acc, s) => {
                        acc.add(`${s.category_name} (${formatINR(s.unit_price)})`);
                        return acc;
                      }, new Set<string>())
                      .size > 0
                      ? Array.from(new Set(b.seats.map((s) => `${s.category_name} ${formatINR(s.unit_price)}`))).join(' · ')
                      : ''}
                  </span>

                  <div className="flex items-center gap-2">
                    {!isCancelled && b.theatre_is_cancellable && tab === 'UPCOMING' && (
                      <button
                        type="button"
                        disabled={cancellingId === b.id}
                        onClick={() => handleCancel(b)}
                        className="px-3.5 py-2 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-semibold transition-colors"
                      >
                        {cancellingId === b.id ? 'Cancelling...' : 'Cancel Ticket'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setActiveQrBooking(b)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-950 hover:bg-slate-800 text-white text-xs font-semibold transition-colors"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      Show QR Pass
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* QR Code Digital Pass Modal */}
      {activeQrBooking && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl border border-slate-200 overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="font-display font-bold text-base text-slate-950">Cinema Entry Pass</h2>
                <p className="text-xs font-mono text-slate-500">{activeQrBooking.booking_code}</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveQrBooking(null)}
                className="w-9 h-9 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 text-center space-y-4">
              <div>
                <h3 className="font-display font-bold text-lg text-slate-950">{activeQrBooking.movie_title}</h3>
                <p className="text-xs text-slate-600 mt-0.5">{activeQrBooking.theatre_name}</p>
                <p className="text-xs font-mono text-slate-700 mt-1">
                  {activeQrBooking.screen_name} · {activeQrBooking.show_date} · {activeQrBooking.show_time}
                </p>
              </div>

              <div className="flex justify-center">
                <TicketQrCode payload={activeQrBooking.qr_payload} size={184} />
              </div>

              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 text-xs text-left space-y-1.5 tabular-nums">
                <div className="flex justify-between">
                  <span className="text-slate-500">Seats</span>
                  <span className="font-mono font-bold text-slate-950">
                    {activeQrBooking.seats.map((s) => s.seat_id).join(', ')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Customer</span>
                  <span className="font-medium text-slate-900">{activeQrBooking.customer_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Subtotal / Fee / GST</span>
                  <span className="font-mono text-slate-700">
                    {formatINR(activeQrBooking.subtotal)} + {formatINR(activeQrBooking.convenience_fee)} +{' '}
                    {formatINR(activeQrBooking.tax_amount)}
                  </span>
                </div>
                <div className="flex justify-between pt-1 border-t border-slate-200 font-bold text-slate-950">
                  <span>Total Paid</span>
                  <span className="font-mono text-emerald-700">{formatINR(activeQrBooking.total_amount)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
