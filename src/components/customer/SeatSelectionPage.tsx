import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  CreditCard,
  Lock,
  Minus,
  Plus,
  RotateCcw,
  Share2,
  ShieldCheck,
  Tag,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuthUser, BookingRecord, ResolvedSeat, ShowSeatMapResponse } from '../../types';
import { apiFetch, getSeatSessionKey, saveGuestBookingCode } from '../../lib/api';
import { formatDateChip, formatINR } from '../../lib/format';
import { TicketQrCode } from '../BrandMark';

interface SeatSelectionPageProps {
  showId: string;
  currentUser: AuthUser | null;
  onBack: () => void;
  onSwitchShow: (newShowId: string) => void;
  onBookingComplete: (booking: BookingRecord) => void;
}

interface LockResponse {
  locked: boolean;
  expires_at: string;
  lock_seconds: number;
  seats: Array<{
    seat_id: string;
    row: string;
    number: number;
    category_id: string;
    category_name: string;
    unit_price: number;
  }>;
  pricing: {
    by_category: Array<{ category_name: string; unit_price: number; count: number; total: number }>;
    subtotal: number;
    discount_amount: number;
    applied_coupon: string | null;
    coupon_error: string | null;
    convenience_fee: number;
    tax_rate_percent: number;
    tax_amount: number;
    total_amount: number;
  };
}

export function SeatSelectionPage({
  showId,
  currentUser,
  onBack,
  onSwitchShow,
  onBookingComplete,
}: SeatSelectionPageProps) {
  const sessionKey = useMemo(() => getSeatSessionKey(), []);
  const [data, setData] = useState<ShowSeatMapResponse | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareToast, setShareToast] = useState<string | null>(null);

  // Checkout & Server Lock state
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [lockData, setLockData] = useState<LockResponse | null>(null);
  const [locking, setLocking] = useState(false);
  const [couponInput, setCouponInput] = useState('');
  const [customerName, setCustomerName] = useState(currentUser?.name || '');
  const [customerMobile, setCustomerMobile] = useState(currentUser?.mobile || '');
  const [customerEmail, setCustomerEmail] = useState(currentUser?.email || '');
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'Card' | 'NetBanking'>('UPI');
  const [paying, setPaying] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [confirmedBooking, setConfirmedBooking] = useState<BookingRecord | null>(null);

  const loadSeatMap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<ShowSeatMapResponse>(
        `/api/shows/${showId}/seat-map?session_key=${encodeURIComponent(sessionKey)}`
      );
      setData(res);
      setSelectedIds([]);
      setCheckoutOpen(false);
      setLockData(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [showId, sessionKey]);

  useEffect(() => {
    loadSeatMap();
  }, [loadSeatMap]);

  useEffect(() => {
    if (currentUser) {
      if (!customerName) setCustomerName(currentUser.name);
      if (!customerMobile) setCustomerMobile(currentUser.mobile);
      if (!customerEmail) setCustomerEmail(currentUser.email);
    }
  }, [currentUser, customerName, customerMobile, customerEmail]);

  // Auto-release temporary locks if user exits checkout modal
  const closeCheckoutAndRelease = async () => {
    setCheckoutOpen(false);
    setLockData(null);
    setCheckoutError(null);
    try {
      await apiFetch(`/api/shows/${showId}/release-session-locks`, {
        method: 'POST',
        body: JSON.stringify({ session_key: sessionKey }),
      });
    } catch {
      // ignore
    }
  };

  const toggleSeat = (seat: ResolvedSeat) => {
    if (seat.status !== 'AVAILABLE') return;
    setSelectedIds((prev) => {
      if (prev.includes(seat.id)) {
        return prev.filter((id) => id !== seat.id);
      }
      if (prev.length >= 10) {
        setShareToast('Maximum 10 seats allowed per booking.');
        setTimeout(() => setShareToast(null), 2200);
        return prev;
      }
      return [...prev, seat.id];
    });
  };

  const selectedSeats = useMemo(() => {
    if (!data) return [];
    const lookup = new Map(data.seats.map((s) => [s.id, s]));
    return selectedIds.map((id) => lookup.get(id)).filter((s): s is ResolvedSeat => Boolean(s));
  }, [data, selectedIds]);

  const livePricing = useMemo(() => {
    if (!data) return { subtotal: 0, convenienceFee: 0, tax: 0, total: 0 };
    const subtotal = selectedSeats.reduce((acc, s) => acc + s.resolved_price, 0);
    const convenienceFee = selectedSeats.length * data.settings.convenience_fee_per_seat;
    const tax = Math.round(((convenienceFee * data.settings.tax_rate_percent) / 100) * 100) / 100;
    return {
      subtotal,
      convenienceFee,
      tax,
      total: Math.round((subtotal + convenienceFee + tax) * 100) / 100,
    };
  }, [data, selectedSeats]);

  // Compute category label banner Y-positions from actual JSON rows
  const categoryMarkers = useMemo(() => {
    if (!data) return [];
    const markers: Array<{ id: string; name: string; price: number; color: string; y: number }> = [];
    for (const cat of data.categories) {
      const catSeats = data.seats.filter((s) => s.category_id === cat.id);
      if (catSeats.length === 0) continue;
      const minY = Math.min(...catSeats.map((s) => s.y));
      markers.push({
        id: cat.id,
        name: cat.name,
        price: cat.resolved_price,
        color: cat.color,
        y: Math.max(8, minY - 26),
      });
    }
    return markers;
  }, [data]);

  const handleLockAndContinue = async (couponOverride?: string) => {
    if (selectedIds.length === 0) return;
    setLocking(true);
    setCheckoutError(null);
    try {
      const res = await apiFetch<LockResponse>(`/api/shows/${showId}/lock-seats`, {
        method: 'POST',
        body: JSON.stringify({
          seat_ids: selectedIds,
          session_key: sessionKey,
          coupon_code: couponOverride !== undefined ? couponOverride : couponInput || undefined,
        }),
      });
      setLockData(res);
      setCheckoutOpen(true);
    } catch (err) {
      const msg = (err as Error).message;
      setCheckoutError(msg);
      setShareToast(msg);
      setTimeout(() => setShareToast(null), 3500);
      loadSeatMap();
    } finally {
      setLocking(false);
    }
  };

  const handleVerifyPayment = async (simulateFailure = false) => {
    if (!customerName.trim() || !customerMobile.trim()) {
      setCheckoutError('Please enter your name and mobile number for ticket delivery.');
      return;
    }
    setPaying(true);
    setCheckoutError(null);
    try {
      const res = await apiFetch<{ booking: BookingRecord }>('/api/bookings/checkout', {
        method: 'POST',
        body: JSON.stringify({
          show_id: showId,
          seat_ids: selectedIds,
          session_key: sessionKey,
          customer_name: customerName.trim(),
          customer_mobile: customerMobile.trim(),
          customer_email: customerEmail.trim(),
          coupon_code: lockData?.pricing.applied_coupon || couponInput || undefined,
          payment_method: paymentMethod,
          payment_gateway: 'Razorpay',
          simulate_failure: simulateFailure,
        }),
      });
      saveGuestBookingCode(res.booking.booking_code);
      setConfirmedBooking(res.booking);
      setCheckoutOpen(false);
      setSelectedIds([]);
      onBookingComplete(res.booking);
    } catch (err) {
      setCheckoutError((err as Error).message);
      if (simulateFailure) {
        setTimeout(() => {
          setCheckoutOpen(false);
          loadSeatMap();
        }, 1600);
      }
    } finally {
      setPaying(false);
    }
  };

  const handleShare = () => {
    const label = data
      ? `${data.movie.title} · ${data.theatre.name} · ${data.show.show_date} ${data.show.start_time}`
      : 'TICKETNOW Seat Map';
    navigator.clipboard?.writeText(`${label} — ${window.location.href}`).catch(() => {});
    setShareToast('Seat map link copied to clipboard');
    setTimeout(() => setShareToast(null), 2200);
  };

  const dateChip = data ? formatDateChip(data.show.show_date) : null;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* 1. COMPACT STICKY WHITE SEAT SELECTION HEADER */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to showtimes"
            className="w-10 h-10 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-900 shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="min-w-0 text-center flex-1">
            <h1 className="font-display font-bold text-sm sm:text-base text-slate-950 truncate leading-tight">
              {data?.movie.title || 'Select Seats'}
            </h1>
            {data && (
              <p className="text-[11px] sm:text-xs text-slate-500 truncate">
                {data.theatre.name} · {data.screen.name}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={handleShare}
            aria-label="Share seat map"
            className="w-10 h-10 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-700 shrink-0"
          >
            <Share2 className="w-4 h-4" />
          </button>
        </div>

        {/* 2. SHOWTIME SWITCHER STRIP */}
        {data && (
          <div className="border-t border-slate-100 bg-white">
            <div className="max-w-6xl mx-auto px-3 sm:px-6 py-2 flex items-center gap-3 overflow-x-auto no-scrollbar">
              {dateChip && (
                <div className="pr-3 border-r border-slate-200 shrink-0 leading-tight">
                  <div className="text-[10px] font-semibold text-slate-500 uppercase">{dateChip.weekdayShort}</div>
                  <div className="font-display font-bold text-xs text-slate-950 tabular-nums whitespace-nowrap">
                    {dateChip.dayNum} {dateChip.monthShort}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                {data.sibling_shows.map((s) => {
                  const active = s.id === data.show.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        if (!active) onSwitchShow(s.id);
                      }}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-semibold transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                        active
                          ? 'bg-slate-950 text-white border-slate-950'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                      }`}
                    >
                      {s.start_time}
                    </button>
                  );
                })}
              </div>

              {/* Zoom controls on right */}
              <div className="ml-auto hidden sm:flex items-center gap-1 pl-3 border-l border-slate-200 shrink-0">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.65, Math.round((z - 0.1) * 100) / 100))}
                  aria-label="Zoom out"
                  className="w-8 h-8 rounded-lg border border-slate-200 hover:bg-slate-100 flex items-center justify-center text-slate-700"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="font-mono text-xs text-slate-600 w-11 text-center tabular-nums">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(1.4, Math.round((z + 0.1) * 100) / 100))}
                  aria-label="Zoom in"
                  className="w-8 h-8 rounded-lg border border-slate-200 hover:bg-slate-100 flex items-center justify-center text-slate-700"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoom(1)}
                  aria-label="Reset zoom"
                  className="w-8 h-8 rounded-lg border border-slate-200 hover:bg-slate-100 flex items-center justify-center text-slate-600"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Toast message */}
      {shareToast && (
        <div className="fixed top-28 left-1/2 -translate-x-1/2 z-50 bg-slate-950 text-white text-xs font-medium px-4 py-2 rounded-xl shadow-lg">
          {shareToast}
        </div>
      )}

      {/* 3. EXACT-JSON DYNAMIC CINEMA SEAT MAP CANVAS */}
      <main className="flex-1 flex flex-col">
        {loading ? (
          <div className="flex-1 flex items-center justify-center p-12 text-sm text-slate-500">
            Loading exact screen layout &amp; live seat availability...
          </div>
        ) : error || !data ? (
          <div className="max-w-lg mx-auto my-12 p-6 rounded-2xl border border-rose-200 bg-rose-50 text-sm text-rose-800">
            {error || 'Unable to load seat map.'}
          </div>
        ) : (
          <>
            {/* Live metrics & mobile zoom controls */}
            <div className="bg-white border-b border-slate-200 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
                <span className="font-semibold text-emerald-700">{data.metrics.available_seats} available</span>
                <span aria-hidden="true">·</span>
                <span>{data.metrics.booked_seats} booked</span>
                {data.metrics.blocked_seats > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{data.metrics.blocked_seats} blocked</span>
                  </>
                )}
              </div>

              <div className="flex sm:hidden items-center gap-1">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.1) * 100) / 100))}
                  className="px-2 py-1 rounded border border-slate-200 bg-white text-xs font-mono"
                >
                  −
                </button>
                <span className="font-mono text-[11px] px-1 tabular-nums">{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(1.3, Math.round((z + 0.1) * 100) / 100))}
                  className="px-2 py-1 rounded border border-slate-200 bg-white text-xs font-mono"
                >
                  +
                </button>
              </div>
            </div>

            {/* Scrollable Canvas Container */}
            <div className="flex-1 overflow-auto px-4 pt-5 pb-48">
              <div
                className="mx-auto"
                style={{
                  width: Math.round(data.layout.screen_width * zoom),
                  minWidth: Math.round(data.layout.screen_width * zoom),
                }}
              >
                {/* Screen Direction at TOP if configured */}
                {data.layout.screen_direction === 'TOP' && (
                  <div className="mb-6 flex flex-col items-center">
                    <div className="w-[72%] h-2.5 rounded-b-full bg-gradient-to-b from-purple-200 to-purple-50 border-b-2 border-purple-500" />
                    <span className="mt-2 text-[11px] font-display font-bold tracking-[0.22em] text-purple-700 uppercase">
                      SCREEN THIS WAY
                    </span>
                  </div>
                )}

                {/* Exact Cartesian Coordinate Canvas */}
                <div
                  className="relative bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden"
                  style={{
                    width: Math.round(data.layout.screen_width * zoom),
                    height: Math.round((data.layout.screen_height + 24) * zoom),
                  }}
                >
                  <div
                    className="relative origin-top-left"
                    style={{
                      width: data.layout.screen_width,
                      height: data.layout.screen_height + 24,
                      transform: `scale(${zoom})`,
                    }}
                  >
                    {/* Category Price Headers */}
                    {categoryMarkers.map((cm) => (
                      <div
                        key={cm.id}
                        style={{ top: cm.y }}
                        className="absolute inset-x-6 flex items-center justify-between border-b border-slate-100 pb-0.5 pointer-events-none"
                      >
                        <span className="text-[11px] font-display font-bold tracking-wide text-slate-700">
                          {cm.name}: <span className="font-mono text-slate-950">{formatINR(cm.price)}</span>
                        </span>
                        <span
                          className="w-2.5 h-2.5 rounded-xs"
                          style={{ backgroundColor: cm.color }}
                          aria-hidden="true"
                        />
                      </div>
                    ))}

                    {/* Subtle Aisle Walkway Guides */}
                    {data.layout.aisles.map((aisle) => (
                      <div
                        key={aisle.id}
                        style={{
                          left: aisle.x,
                          top: aisle.y,
                          width: aisle.width,
                          height: aisle.height,
                        }}
                        className="absolute pointer-events-none flex items-center justify-center"
                      >
                        {aisle.orientation === 'horizontal' && (
                          <div className="w-full border-t border-dashed border-slate-200/80" />
                        )}
                      </div>
                    ))}

                    {/* Row Labels */}
                    {data.layout.rows.map((r) => (
                      <div
                        key={r.label}
                        style={{ top: r.y + 4, left: 16 }}
                        className="absolute font-mono font-bold text-xs text-slate-400 select-none w-6 text-center"
                      >
                        {r.label}
                      </div>
                    ))}

                    {/* Exact Positioned Seats */}
                    {data.seats.map((seat) => {
                      const isSelected = selectedIds.includes(seat.id);
                      const isAvailable = seat.status === 'AVAILABLE';
                      const isOccupied = seat.status === 'OCCUPIED';
                      const isBlocked = seat.status === 'BLOCKED';
                      const isLocked = seat.status === 'LOCKED';

                      let seatClass =
                        'bg-white text-slate-800 border-slate-700 hover:border-purple-600 hover:bg-purple-50/50 cursor-pointer';
                      if (isSelected) {
                        seatClass =
                          'bg-purple-600 text-white border-purple-700 ring-2 ring-purple-300 cursor-pointer shadow-xs';
                      } else if (isOccupied) {
                        seatClass = 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed';
                      } else if (isBlocked) {
                        seatClass = 'bg-slate-600 text-slate-200 border-slate-700 cursor-not-allowed';
                      } else if (isLocked) {
                        seatClass = 'bg-amber-100 text-amber-700 border-amber-300 cursor-not-allowed';
                      }

                      const shapeClass =
                        seat.seat_type === 'RECLINER' || seat.seat_type === 'SOFA'
                          ? 'rounded-t-lg rounded-b-sm'
                          : seat.seat_type === 'COUPLE'
                          ? 'rounded-lg'
                          : 'rounded-md';

                      return (
                        <button
                          key={seat.id}
                          type="button"
                          disabled={!isAvailable}
                          onClick={() => toggleSeat(seat)}
                          title={`${seat.id} · ${seat.category_name} (${seat.seat_type}) · ${formatINR(seat.resolved_price)} · ${seat.status}`}
                          style={{
                            left: seat.x,
                            top: seat.y,
                            width: seat.width,
                            height: seat.height,
                          }}
                          className={`absolute border flex items-center justify-center font-mono text-[11px] font-semibold transition-colors select-none ${shapeClass} ${seatClass}`}
                        >
                          {isOccupied ? (
                            <span className="text-slate-400 font-sans text-xs leading-none">×</span>
                          ) : isBlocked ? (
                            <span className="text-[9px] font-bold">BLK</span>
                          ) : isLocked ? (
                            <Lock className="w-3 h-3" />
                          ) : (
                            <span>{seat.number}</span>
                          )}
                          {seat.seat_type === 'RECLINER' && isAvailable && !isSelected && (
                            <span
                              className="absolute bottom-0.5 inset-x-1.5 h-0.5 rounded-full"
                              style={{ backgroundColor: seat.category_color }}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 4. SCREEN DIRECTION AT BOTTOM (DEFAULT) */}
                {data.layout.screen_direction !== 'TOP' && (
                  <div className="mt-7 flex flex-col items-center">
                    <svg width="360" height="22" viewBox="0 0 360 22" fill="none" className="max-w-full">
                      <path
                        d="M12 18C90 3 270 3 348 18"
                        stroke="#7C3AED"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                      />
                      <path
                        d="M24 21C96 9 264 9 336 21"
                        stroke="#DDD6FE"
                        strokeWidth="3"
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="mt-1.5 text-xs font-display font-bold tracking-[0.2em] text-purple-700 uppercase">
                      SCREEN THIS WAY
                    </span>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {/* 8. FIXED BOTTOM WHITE SEAT LEGEND + LIVE BOOKING SUMMARY */}
      {data && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-200 shadow-[0_-6px_24px_rgba(15,23,42,0.06)] pb-safe">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 space-y-3">
            {/* Compact Status Legend */}
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-4 h-4 rounded border border-slate-700 bg-white inline-block" />
                Available
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-4 h-4 rounded border border-slate-200 bg-slate-100 text-slate-400 inline-flex items-center justify-center text-[11px] leading-none">
                  ×
                </span>
                Occupied
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-4 h-4 rounded border border-purple-700 bg-purple-600 inline-block" />
                Selected
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-4 h-4 rounded border border-slate-700 bg-slate-600 inline-block" />
                Blocked
              </span>
            </div>

            {/* Selected Seats Price Summary & Continue CTA */}
            {selectedSeats.length > 0 && (
              <div className="pt-2.5 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-slate-500 truncate">
                    Selected Seats:{' '}
                    <span className="font-mono font-bold text-slate-950">
                      {selectedSeats.map((s) => s.id).join(', ')}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600 mt-0.5 tabular-nums">
                    <span>Tickets: {formatINR(livePricing.subtotal)}</span>
                    <span>·</span>
                    <span>Convenience Fee + GST: {formatINR(livePricing.convenienceFee + livePricing.tax)}</span>
                    <span>·</span>
                    <span className="font-display font-bold text-sm text-slate-950">
                      Total: {formatINR(livePricing.total)}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={locking}
                  onClick={() => handleLockAndContinue()}
                  className="h-11 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-display font-bold text-sm transition-colors whitespace-nowrap shrink-0"
                >
                  {locking ? 'Locking Seats...' : `Continue · ${formatINR(livePricing.total)}`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CHECKOUT & PAYMENT VERIFICATION MODAL */}
      {checkoutOpen && lockData && data && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl max-h-[92vh] overflow-y-auto border border-slate-200 shadow-2xl">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-4 flex items-center justify-between">
              <div>
                <h2 className="font-display font-bold text-base text-slate-950">Booking Summary &amp; Checkout</h2>
                <p className="text-xs text-emerald-700 flex items-center gap-1 mt-0.5">
                  <Clock className="w-3.5 h-3.5" />
                  Seats locked on server for {Math.round(lockData.lock_seconds / 60)} mins
                </p>
              </div>
              <button
                type="button"
                onClick={closeCheckoutAndRelease}
                aria-label="Close checkout"
                className="w-9 h-9 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Show & Seats Summary */}
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2">
                <div className="font-display font-bold text-sm text-slate-950">{data.movie.title}</div>
                <div className="text-xs text-slate-600">
                  {data.theatre.name} · {data.screen.name}
                </div>
                <div className="text-xs font-mono text-slate-700">
                  {data.show.show_date} · {data.show.start_time} · Seats:{' '}
                  <strong>{lockData.seats.map((s) => s.seat_id).join(', ')}</strong>
                </div>
              </div>

              {/* Transparent Category-Wise Server Price Breakdown */}
              <div className="space-y-2 text-sm">
                <div className="font-display font-semibold text-xs uppercase tracking-wide text-slate-500">
                  Price Breakdown (Server-Verified)
                </div>
                {lockData.pricing.by_category.map((line, i) => (
                  <div key={i} className="flex items-center justify-between text-slate-700 tabular-nums">
                    <span>
                      {line.category_name}: {formatINR(line.unit_price)} × {line.count}
                    </span>
                    <span className="font-mono font-medium">{formatINR(line.total)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-slate-600 tabular-nums">
                  <span>Convenience Fee ({lockData.seats.length} seats)</span>
                  <span className="font-mono">{formatINR(lockData.pricing.convenience_fee)}</span>
                </div>
                <div className="flex items-center justify-between text-slate-600 tabular-nums">
                  <span>Applicable GST ({lockData.pricing.tax_rate_percent}%)</span>
                  <span className="font-mono">{formatINR(lockData.pricing.tax_amount)}</span>
                </div>
                {lockData.pricing.discount_amount > 0 && (
                  <div className="flex items-center justify-between text-emerald-700 font-medium tabular-nums">
                    <span>Promo Discount ({lockData.pricing.applied_coupon})</span>
                    <span className="font-mono">−{formatINR(lockData.pricing.discount_amount)}</span>
                  </div>
                )}
                <div className="pt-2.5 border-t border-slate-200 flex items-center justify-between font-display font-bold text-base text-slate-950 tabular-nums">
                  <span>Payable Total</span>
                  <span className="font-mono">{formatINR(lockData.pricing.total_amount)}</span>
                </div>
              </div>

              {/* Promo Coupon Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-emerald-600" />
                  Apply Promo Code (Try ATMOS100 or TICKET20)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                    placeholder="Enter coupon code"
                    className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-mono uppercase focus:outline-none focus:border-emerald-600"
                  />
                  <button
                    type="button"
                    onClick={() => handleLockAndContinue(couponInput)}
                    disabled={locking}
                    className="px-4 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-white text-xs font-semibold whitespace-nowrap shrink-0"
                  >
                    Apply
                  </button>
                </div>
                {lockData.pricing.coupon_error && (
                  <p className="text-xs text-rose-600">{lockData.pricing.coupon_error}</p>
                )}
              </div>

              {/* Customer Contact Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Full Name</label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Arjun Karthik"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-emerald-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Mobile Number</label>
                  <input
                    type="tel"
                    value={customerMobile}
                    onChange={(e) => setCustomerMobile(e.target.value)}
                    placeholder="+91 98421 00000"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-emerald-600"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Email (for QR copy)</label>
                  <input
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-emerald-600"
                  />
                </div>
              </div>

              {/* Payment Method */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5 text-emerald-600" />
                  Payment Method
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(['UPI', 'Card', 'NetBanking'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPaymentMethod(m)}
                      className={`py-2.5 rounded-xl border text-xs font-semibold transition-colors ${
                        paymentMethod === m
                          ? 'bg-slate-950 text-white border-slate-950'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {checkoutError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700">
                  {checkoutError}
                </div>
              )}

              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  disabled={paying}
                  onClick={() => handleVerifyPayment(false)}
                  className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-display font-bold text-sm flex items-center justify-center gap-2 transition-colors"
                >
                  <ShieldCheck className="w-4 h-4" />
                  {paying ? 'Verifying Payment...' : `Pay ${formatINR(lockData.pricing.total_amount)} & Confirm`}
                </button>
                <button
                  type="button"
                  disabled={paying}
                  onClick={() => handleVerifyPayment(true)}
                  className="w-full py-2 text-xs font-medium text-slate-500 hover:text-rose-700 transition-colors"
                >
                  Simulate Payment Failure (Verify Seat Lock Release)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DIGITAL TICKET CONFIRMATION MODAL WITH SCANNABLE QR CODE */}
      {confirmedBooking && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
            <div className="bg-emerald-600 text-white px-5 py-4 flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 shrink-0" />
              <div>
                <h2 className="font-display font-bold text-base">Booking Confirmed!</h2>
                <p className="text-xs text-emerald-100 font-mono">{confirmedBooking.booking_code}</p>
              </div>
            </div>

            <div className="p-5 space-y-4">
              <div className="text-center space-y-1">
                <h3 className="font-display font-bold text-lg text-slate-950">{confirmedBooking.movie_title}</h3>
                <p className="text-xs text-slate-600">{confirmedBooking.theatre_name}</p>
                <p className="text-xs font-mono text-slate-700">
                  {confirmedBooking.screen_name} · {confirmedBooking.show_date} · {confirmedBooking.show_time}
                </p>
              </div>

              <div className="flex justify-center py-2">
                <TicketQrCode payload={confirmedBooking.qr_payload} size={172} />
              </div>

              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 text-xs space-y-1.5 tabular-nums">
                <div className="flex justify-between">
                  <span className="text-slate-500">Seats ({confirmedBooking.seat_count})</span>
                  <span className="font-mono font-bold text-slate-950">
                    {confirmedBooking.seats.map((s) => s.seat_id).join(', ')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Amount Paid</span>
                  <span className="font-mono font-bold text-emerald-700">
                    {formatINR(confirmedBooking.total_amount)}
                  </span>
                </div>
                {confirmedBooking.transaction_id && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Transaction ID</span>
                    <span className="font-mono text-slate-700">{confirmedBooking.transaction_id}</span>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setConfirmedBooking(null);
                  onBack();
                }}
                className="w-full h-11 rounded-xl bg-slate-950 hover:bg-slate-800 text-white font-display font-bold text-sm"
              >
                Done · View in My Bookings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
