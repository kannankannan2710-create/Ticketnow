import crypto from 'crypto';
import { db } from './db.ts';
import type {
  AppSettings,
  AuthUser,
  AvailabilityIndicator,
  BookingRecord,
  BookingWindow,
  Movie,
  MovieBookingAvailability,
  MovieHomepageShowTiming,
  ResolvedSeat,
  ScreenLayoutV2,
  Show,
  ShowAvailabilityMetrics,
  UserRole,
} from '../src/types.ts';

export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';
export const DEFAULT_CITY = 'Tirunelveli';

export function uid(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

export function getSettings(): AppSettings {
  const row = db.prepare('SELECT * FROM settings WHERE id = 1').get() as AppSettings | undefined;
  return (
    row ?? {
      app_name: 'TICKETNOW',
      app_logo_url: '',
      contact_email: 'support@ticketnow.in',
      contact_phone: '+91 4633 224 890',
      support_hours: '08:00 AM – 11:30 PM IST',
      currency: 'INR',
      convenience_fee_per_seat: 15,
      tax_rate_percent: 18,
      cancellation_policy:
        'Tickets for cancellable theatres can be cancelled up to 2 hours prior to showtime for a 75% refund.',
      terms_text: 'Standard TICKETNOW booking terms apply.',
      privacy_text: 'Standard TICKETNOW privacy policy applies.',
      lock_duration_seconds: 300,
    }
  );
}

export function purgeExpiredLocks(): number {
  const nowIso = new Date().toISOString();
  const res = db.prepare('DELETE FROM seat_locks WHERE expires_at <= ?').run(nowIso);
  return res.changes;
}

export function getCinemaDateTimeParts(d: Date = new Date()): {
  dateStr: string;
  minutesOfDay: number;
} {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: APP_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
    const year = get('year');
    const month = get('month');
    const day = get('day');
    const hour = Number(get('hour')) % 24;
    const minute = Number(get('minute'));
    return {
      dateStr: `${year}-${month}-${day}`,
      minutesOfDay: hour * 60 + minute,
    };
  } catch {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return {
      dateStr: `${y}-${m}-${day}`,
      minutesOfDay: d.getHours() * 60 + d.getMinutes(),
    };
  }
}

export function formatLocalDate(d: Date): string {
  return getCinemaDateTimeParts(d).dateStr;
}

export function parseTimeToMinutesStrict(timeStr: string): number | null {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const trimmed = timeStr.trim().toUpperCase();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const mins = parseInt(match[2], 10);
  const meridiem = match[3];
  if (Number.isNaN(hours) || Number.isNaN(mins) || mins < 0 || mins > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'PM' && hours < 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;
  } else if (hours < 0 || hours > 23) {
    return null;
  }
  return hours * 60 + mins;
}

export function parseTimeToMinutes(timeStr: string): number {
  return parseTimeToMinutesStrict(timeStr) ?? 0;
}

export function isShowExpired(showDate: string, startTime: string, now: Date = new Date()): boolean {
  if (!showDate || !/^\d{4}-\d{2}-\d{2}$/.test(showDate.trim())) {
    return true;
  }
  const startMinutes = parseTimeToMinutesStrict(startTime);
  if (startMinutes === null) {
    return true;
  }
  const normalizedDate = showDate.trim();
  const { dateStr: todayStr, minutesOfDay: nowMins } = getCinemaDateTimeParts(now);
  if (normalizedDate < todayStr) return true;
  if (normalizedDate > todayStr) return false;
  return startMinutes <= nowMins;
}

export function checkShowOverlap(
  screenId: string,
  showDate: string,
  startTime: string,
  endTime: string,
  excludeShowId?: string
): { overlaps: boolean; conflictingShow?: { id: string; start_time: string; end_time: string } } {
  const newStart = parseTimeToMinutes(startTime);
  let newEnd = parseTimeToMinutes(endTime);
  if (newEnd <= newStart) newEnd += 24 * 60;

  const existing = db
    .prepare(
      `SELECT id, start_time, end_time FROM shows
       WHERE screen_id = ? AND show_date = ? AND status != 'CANCELLED'`
    )
    .all(screenId, showDate) as Array<{ id: string; start_time: string; end_time: string }>;

  for (const row of existing) {
    if (excludeShowId && row.id === excludeShowId) continue;
    const s = parseTimeToMinutes(row.start_time);
    let e = parseTimeToMinutes(row.end_time);
    if (e <= s) e += 24 * 60;
    if (newStart < e && s < newEnd) {
      return { overlaps: true, conflictingShow: row };
    }
  }
  return { overlaps: false };
}

interface RawWindow {
  id: string;
  scope_type: 'GLOBAL' | 'MOVIE' | 'SHOW';
  scope_id: string;
  booking_open_at: string;
  booking_close_at: string;
  advance_enabled: number;
  max_advance_days: number;
  advance_start_date: string | null;
  advance_end_date: string | null;
  status: 'OPEN' | 'CLOSED' | 'SCHEDULED';
  announcement_text: string | null;
}

export function getEffectiveBookingWindow(movieId: string, showId?: string): RawWindow | null {
  if (showId) {
    const showWin = db
      .prepare(`SELECT * FROM booking_windows WHERE scope_type = 'SHOW' AND scope_id = ?`)
      .get(showId) as RawWindow | undefined;
    if (showWin) return showWin;
  }
  const movieWin = db
    .prepare(`SELECT * FROM booking_windows WHERE scope_type = 'MOVIE' AND scope_id = ?`)
    .get(movieId) as RawWindow | undefined;
  if (movieWin) return movieWin;

  const globalWin = db
    .prepare(`SELECT * FROM booking_windows WHERE scope_type = 'GLOBAL' AND scope_id = 'ALL'`)
    .get() as RawWindow | undefined;
  return globalWin ?? null;
}

export function evaluateWindowState(
  win: RawWindow | null,
  showOverrideOpen?: string | null,
  showOverrideClose?: string | null
): {
  state: 'OPEN' | 'SCHEDULED' | 'CLOSED';
  opensAt: string | null;
  closesAt: string | null;
  maxAdvanceDays: number;
  advanceEnabled: boolean;
  advanceStartDate: string | null;
  advanceEndDate: string | null;
  announcement: string | null;
} {
  const nowMs = Date.now();
  const opensAt = showOverrideOpen || win?.booking_open_at || null;
  const closesAt = showOverrideClose || win?.booking_close_at || null;
  const maxAdvanceDays = win?.max_advance_days ?? 7;
  const advanceEnabled = win ? Boolean(win.advance_enabled) : true;

  if (win?.status === 'CLOSED') {
    return {
      state: 'CLOSED',
      opensAt,
      closesAt,
      maxAdvanceDays,
      advanceEnabled,
      advanceStartDate: win?.advance_start_date ?? null,
      advanceEndDate: win?.advance_end_date ?? null,
      announcement: win?.announcement_text ?? null,
    };
  }

  if (opensAt) {
    const openMs = new Date(opensAt).getTime();
    if (!Number.isNaN(openMs) && nowMs < openMs) {
      return {
        state: 'SCHEDULED',
        opensAt,
        closesAt,
        maxAdvanceDays,
        advanceEnabled,
        advanceStartDate: win?.advance_start_date ?? null,
        advanceEndDate: win?.advance_end_date ?? null,
        announcement: win?.announcement_text ?? null,
      };
    }
  }

  if (closesAt) {
    const closeMs = new Date(closesAt).getTime();
    if (!Number.isNaN(closeMs) && nowMs > closeMs) {
      return {
        state: 'CLOSED',
        opensAt,
        closesAt,
        maxAdvanceDays,
        advanceEnabled,
        advanceStartDate: win?.advance_start_date ?? null,
        advanceEndDate: win?.advance_end_date ?? null,
        announcement: win?.announcement_text ?? null,
      };
    }
  }

  return {
    state: 'OPEN',
    opensAt,
    closesAt,
    maxAdvanceDays,
    advanceEnabled,
    advanceStartDate: win?.advance_start_date ?? null,
    advanceEndDate: win?.advance_end_date ?? null,
    announcement: win?.announcement_text ?? null,
  };
}

export function isDateEligibleForBooking(
  showDate: string,
  winEval: ReturnType<typeof evaluateWindowState>
): boolean {
  if (!showDate || !/^\d{4}-\d{2}-\d{2}$/.test(showDate.trim())) return false;
  const todayStr = formatLocalDate(new Date());
  if (showDate < todayStr) return false;

  if (!winEval.advanceEnabled && showDate > todayStr) {
    return false;
  }

  const baseToday = new Date(`${todayStr}T12:00:00Z`);
  baseToday.setUTCDate(baseToday.getUTCDate() + Math.max(0, winEval.maxAdvanceDays - 1));
  const maxDateStr = baseToday.toISOString().slice(0, 10);
  if (showDate > maxDateStr) return false;

  if (winEval.advanceStartDate && showDate < winEval.advanceStartDate) {
    return false;
  }
  if (winEval.advanceEndDate && showDate > winEval.advanceEndDate) {
    return false;
  }

  return true;
}

interface PricingRow {
  movie_id: string;
  theatre_id: string | null;
  screen_id: string | null;
  show_id: string | null;
  category_id: string;
  price: number;
}

export function resolveSeatPrices(
  layout: ScreenLayoutV2,
  movieId: string,
  theatreId: string,
  screenId: string,
  showId: string
): {
  categoryPrices: Map<string, { price: number; source: ResolvedSeat['price_source'] }>;
  resolveSeatPrice: (seat: ScreenLayoutV2['seats'][number]) => {
    price: number;
    source: ResolvedSeat['price_source'];
  };
} {
  const rules = db
    .prepare('SELECT movie_id, theatre_id, screen_id, show_id, category_id, price FROM movie_pricing WHERE movie_id = ?')
    .all(movieId) as PricingRow[];

  const categoryPrices = new Map<string, { price: number; source: ResolvedSeat['price_source'] }>();

  for (const cat of layout.categories) {
    // Priority 2: Show-specific category price
    const showRule = rules.find((r) => r.category_id === cat.id && r.show_id === showId);
    if (showRule) {
      categoryPrices.set(cat.id, { price: showRule.price, source: 'SHOW_CATEGORY' });
      continue;
    }

    // Priority 3: Movie-specific category price (screen > theatre > movie-wide)
    const screenMovieRule = rules.find(
      (r) => r.category_id === cat.id && !r.show_id && r.screen_id === screenId
    );
    if (screenMovieRule) {
      categoryPrices.set(cat.id, { price: screenMovieRule.price, source: 'MOVIE_CATEGORY' });
      continue;
    }

    const theatreMovieRule = rules.find(
      (r) => r.category_id === cat.id && !r.show_id && !r.screen_id && r.theatre_id === theatreId
    );
    if (theatreMovieRule) {
      categoryPrices.set(cat.id, { price: theatreMovieRule.price, source: 'MOVIE_CATEGORY' });
      continue;
    }

    const movieRule = rules.find(
      (r) => r.category_id === cat.id && !r.show_id && !r.screen_id && !r.theatre_id
    );
    if (movieRule) {
      categoryPrices.set(cat.id, { price: movieRule.price, source: 'MOVIE_CATEGORY' });
      continue;
    }

    // Priority 4: Screen/Theatre default category price from JSON
    categoryPrices.set(cat.id, { price: cat.price, source: 'SCREEN_DEFAULT' });
  }

  return {
    categoryPrices,
    resolveSeatPrice: (seat) => {
      // Priority 1: Individual seat price override
      if (typeof seat.price_override === 'number' && seat.price_override > 0) {
        return { price: seat.price_override, source: 'SEAT_OVERRIDE' };
      }
      const catResolved = categoryPrices.get(seat.category_id);
      return catResolved ?? { price: 150, source: 'SCREEN_DEFAULT' };
    },
  };
}

export function computeShowMetrics(showRow: {
  id: string;
  movie_id: string;
  theatre_id: string;
  screen_id: string;
  show_date: string;
  start_time?: string;
  booking_open_at: string | null;
  booking_close_at: string | null;
  status: string;
}): ShowAvailabilityMetrics {
  purgeExpiredLocks();

  const screenRow = db
    .prepare('SELECT layout_json, status FROM screens WHERE id = ?')
    .get(showRow.screen_id) as { layout_json: string; status: string } | undefined;
  const theatreRow = db
    .prepare('SELECT status FROM theatres WHERE id = ?')
    .get(showRow.theatre_id) as { status: string } | undefined;

  let resolvedStartTime = showRow.start_time;
  if (!resolvedStartTime) {
    const tRow = db.prepare('SELECT start_time FROM shows WHERE id = ?').get(showRow.id) as
      | { start_time: string }
      | undefined;
    resolvedStartTime = tRow?.start_time || '';
  }

  const layout: ScreenLayoutV2 = screenRow
    ? JSON.parse(screenRow.layout_json)
    : {
        schema_version: '2.0',
        theatre_id: showRow.theatre_id,
        theatre_name: '',
        screen_id: showRow.screen_id,
        screen_name: '',
        screen_width: 800,
        screen_height: 500,
        screen_direction: 'BOTTOM',
        coordinate_system: 'cartesian_px',
        categories: [],
        rows: [],
        seats: [],
        aisles: [],
      };

  const totalSeats = layout.seats.length;
  const bookedCount = (
    db.prepare('SELECT COUNT(*) as c FROM booking_seats WHERE show_id = ?').get(showRow.id) as { c: number }
  ).c;
  const showBlockedRows = db
    .prepare('SELECT seat_id FROM show_seat_blocks WHERE show_id = ?')
    .all(showRow.id) as Array<{ seat_id: string }>;
  const blockedSeatSet = new Set<string>(showBlockedRows.map((r) => r.seat_id));
  if (Array.isArray(layout.blocked_seats)) {
    for (const sid of layout.blocked_seats) blockedSeatSet.add(sid);
  }
  for (const s of layout.seats) {
    if (s.status === 'BLOCKED' || s.status === 'DISABLED') blockedSeatSet.add(s.id);
  }
  const blockedCount = blockedSeatSet.size;
  const lockedCount = (
    db.prepare('SELECT COUNT(*) as c FROM seat_locks WHERE show_id = ?').get(showRow.id) as { c: number }
  ).c;

  // CRITICAL: Never count admin-blocked or blueprint-blocked seats as available
  const sellableSeats = Math.max(0, totalSeats - blockedCount);
  const availableSeats = Math.max(0, sellableSeats - bookedCount - lockedCount);
  const availabilityPct = sellableSeats > 0 ? Math.round((availableSeats / sellableSeats) * 100) : 0;

  const win = getEffectiveBookingWindow(showRow.movie_id, showRow.id);
  const winEval = evaluateWindowState(win, showRow.booking_open_at, showRow.booking_close_at);
  const expired = isShowExpired(showRow.show_date, resolvedStartTime);
  const dateOk = !expired && isDateEligibleForBooking(showRow.show_date, winEval);
  const entitiesActive =
    showRow.status === 'ACTIVE' &&
    (!screenRow || screenRow.status === 'ACTIVE') &&
    (!theatreRow || theatreRow.status === 'ACTIVE');

  let bookingState: 'OPEN' | 'SCHEDULED' | 'CLOSED' = winEval.state;
  if (!entitiesActive || expired) {
    bookingState = 'CLOSED';
  } else if (bookingState === 'OPEN' && !dateOk) {
    bookingState = 'CLOSED';
  }

  let indicator: AvailabilityIndicator;
  if (bookingState === 'SCHEDULED') {
    indicator = 'BOOKING_NOT_OPEN';
  } else if (bookingState === 'CLOSED') {
    indicator = 'BOOKING_CLOSED';
  } else if (availableSeats <= 0) {
    indicator = 'SOLD_OUT';
  } else if (availabilityPct < 20) {
    indicator = 'ALMOST_FULL';
  } else if (availabilityPct <= 50) {
    indicator = 'FAST_FILLING';
  } else {
    indicator = 'AVAILABLE';
  }

  const { categoryPrices } = resolveSeatPrices(
    layout,
    showRow.movie_id,
    showRow.theatre_id,
    showRow.screen_id,
    showRow.id
  );
  const allPrices = Array.from(categoryPrices.values()).map((v) => v.price);
  const minPrice = allPrices.length > 0 ? Math.min(...allPrices) : 120;

  return {
    total_seats: totalSeats,
    sellable_seats: sellableSeats,
    available_seats: availableSeats,
    booked_seats: bookedCount,
    blocked_seats: blockedCount,
    locked_seats: lockedCount,
    availability_pct: availabilityPct,
    indicator,
    booking_open: bookingState === 'OPEN' && availableSeats > 0,
    booking_state: bookingState,
    opens_at: winEval.opensAt,
    closes_at: winEval.closesAt,
    min_price: minPrice,
  };
}

export function computeMovieAvailability(movieId: string, movieStatus: string, city?: string): MovieBookingAvailability {
  const win = getEffectiveBookingWindow(movieId);
  const winEval = evaluateWindowState(win);
  const effectiveCity = city && city.trim() ? city.trim() : 'All Cities';
  const filterByCity = effectiveCity !== 'All Cities';

  const showsQuery = filterByCity
    ? `SELECT s.*,
              t.name as theatre_name, t.logo_code as theatre_logo_code, t.city as theatre_city, t.distance_km as theatre_distance_km,
              sc.name as screen_name
       FROM shows s
       JOIN theatres t ON t.id = s.theatre_id
       JOIN screens sc ON sc.id = s.screen_id
       WHERE s.movie_id = ?
         AND s.status = 'ACTIVE'
         AND t.status = 'ACTIVE'
         AND sc.status = 'ACTIVE'
         AND LOWER(TRIM(t.city)) = LOWER(TRIM(?))`
    : `SELECT s.*,
              t.name as theatre_name, t.logo_code as theatre_logo_code, t.city as theatre_city, t.distance_km as theatre_distance_km,
              sc.name as screen_name
       FROM shows s
       JOIN theatres t ON t.id = s.theatre_id
       JOIN screens sc ON sc.id = s.screen_id
       WHERE s.movie_id = ?
         AND s.status = 'ACTIVE'
         AND t.status = 'ACTIVE'
         AND sc.status = 'ACTIVE'`;

  const rawShows = (
    filterByCity ? db.prepare(showsQuery).all(movieId, effectiveCity) : db.prepare(showsQuery).all(movieId)
  ) as Array<{
    id: string;
    movie_id: string;
    theatre_id: string;
    theatre_name: string;
    theatre_logo_code: string;
    theatre_city: string;
    theatre_distance_km: number;
    screen_id: string;
    screen_name: string;
    show_date: string;
    start_time: string;
    format: string;
    sound_system: string;
    booking_open_at: string | null;
    booking_close_at: string | null;
    status: string;
  }>;

  // Strictly drop expired shows (past date or today's showtime already passed)
  const nonExpiredShows = rawShows.filter((s) => !isShowExpired(s.show_date, s.start_time));

  const emptySummary = {
    city: effectiveCity,
    formats: [] as string[],
    theatre_names: [] as string[],
    dates: [] as string[],
    timings: [] as MovieHomepageShowTiming[],
  };

  if (winEval.state === 'SCHEDULED' && nonExpiredShows.length > 0) {
    const scheduledDates = Array.from(new Set(nonExpiredShows.map((s) => s.show_date))).sort();
    const scheduledFormats = Array.from(new Set(nonExpiredShows.map((s) => s.format).filter(Boolean)));
    const scheduledTheatres = Array.from(new Set(nonExpiredShows.map((s) => s.theatre_name).filter(Boolean)));
    return {
      state: 'SCHEDULED',
      label: 'BOOKING OPENS SOON',
      can_book: false,
      opens_at: winEval.opensAt,
      closes_at: winEval.closesAt,
      max_advance_days: winEval.maxAdvanceDays,
      announcement: winEval.announcement,
      eligible_dates: scheduledDates,
      min_price: null,
      active_show_count: nonExpiredShows.length,
      schedule_summary: {
        city: effectiveCity,
        formats: scheduledFormats,
        theatre_names: scheduledTheatres,
        dates: scheduledDates,
        timings: [],
      },
    };
  }

  if (winEval.state === 'CLOSED') {
    return {
      state: 'CLOSED',
      label: 'BOOKING CLOSED',
      can_book: false,
      opens_at: winEval.opensAt,
      closes_at: winEval.closesAt,
      max_advance_days: winEval.maxAdvanceDays,
      announcement: winEval.announcement,
      eligible_dates: [],
      min_price: null,
      active_show_count: 0,
      schedule_summary: emptySummary,
    };
  }

  if (nonExpiredShows.length === 0) {
    return {
      state: movieStatus === 'UPCOMING' ? 'COMING_SOON' : 'NO_SHOWS',
      label: movieStatus === 'UPCOMING' ? 'COMING SOON' : 'NO ACTIVE SHOWS',
      can_book: false,
      opens_at: winEval.opensAt,
      closes_at: winEval.closesAt,
      max_advance_days: winEval.maxAdvanceDays,
      announcement: winEval.announcement,
      eligible_dates: [],
      min_price: null,
      active_show_count: 0,
      schedule_summary: emptySummary,
    };
  }

  const eligibleShows = nonExpiredShows.filter((s) => {
    const showWin = getEffectiveBookingWindow(movieId, s.id);
    const showEval = evaluateWindowState(showWin, s.booking_open_at, s.booking_close_at);
    return showEval.state === 'OPEN' && isDateEligibleForBooking(s.show_date, showEval);
  });

  if (eligibleShows.length === 0) {
    return {
      state: movieStatus === 'UPCOMING' ? 'COMING_SOON' : 'NO_SHOWS',
      label: movieStatus === 'UPCOMING' ? 'COMING SOON' : 'NO ACTIVE SHOWS',
      can_book: false,
      opens_at: winEval.opensAt,
      closes_at: winEval.closesAt,
      max_advance_days: winEval.maxAdvanceDays,
      announcement: winEval.announcement,
      eligible_dates: [],
      min_price: null,
      active_show_count: 0,
      schedule_summary: emptySummary,
    };
  }

  // Sort deterministically by date, then chronological start time, then theatre distance
  eligibleShows.sort((a, b) => {
    if (a.show_date !== b.show_date) return a.show_date.localeCompare(b.show_date);
    const ta = parseTimeToMinutes(a.start_time);
    const tb = parseTimeToMinutes(b.start_time);
    if (ta !== tb) return ta - tb;
    return (a.theatre_distance_km ?? 0) - (b.theatre_distance_km ?? 0);
  });

  const eligibleDates = Array.from(new Set(eligibleShows.map((s) => s.show_date))).sort();
  const formats = Array.from(new Set(eligibleShows.map((s) => s.format).filter(Boolean)));
  const theatreNames = Array.from(
    new Set(
      [...eligibleShows]
        .sort((a, b) => (a.theatre_distance_km ?? 0) - (b.theatre_distance_km ?? 0))
        .map((s) => s.theatre_name)
        .filter(Boolean)
    )
  );

  let minPrice: number | null = null;
  const timings: MovieHomepageShowTiming[] = [];

  for (const s of eligibleShows) {
    const m = computeShowMetrics(s);
    if (minPrice === null || m.min_price < minPrice) {
      minPrice = m.min_price;
    }
    if (m.booking_state === 'OPEN' && m.available_seats > 0) {
      timings.push({
        show_id: s.id,
        show_date: s.show_date,
        start_time: s.start_time,
        theatre_id: s.theatre_id,
        theatre_name: s.theatre_name,
        theatre_logo_code: s.theatre_logo_code,
        screen_name: s.screen_name,
        format: s.format,
        sound_system: s.sound_system,
        available_seats: m.available_seats,
        indicator: m.indicator,
        min_price: m.min_price,
      });
    }
  }

  return {
    state: 'OPEN',
    label: 'BOOK TICKETS',
    can_book: true,
    opens_at: winEval.opensAt,
    closes_at: winEval.closesAt,
    max_advance_days: winEval.maxAdvanceDays,
    announcement: winEval.announcement,
    eligible_dates: eligibleDates,
    min_price: minPrice,
    active_show_count: eligibleShows.length,
    schedule_summary: {
      city: effectiveCity,
      formats,
      theatre_names: theatreNames,
      dates: eligibleDates,
      timings,
    },
  };
}

export function hydrateMovieRow(row: Record<string, unknown>, city?: string): Movie {
  const movieId = String(row.id);
  const status = String(row.status) as Movie['status'];
  return {
    id: movieId,
    title: String(row.title),
    language: String(row.language),
    genre: String(row.genre),
    certification: String(row.certification),
    duration_mins: Number(row.duration_mins),
    release_date: String(row.release_date),
    poster_url: String(row.poster_url),
    banner_url: row.banner_url ? String(row.banner_url) : null,
    trailer_url: row.trailer_url ? String(row.trailer_url) : null,
    description: String(row.description),
    cast: JSON.parse(String(row.cast_json || '[]')),
    crew: JSON.parse(String(row.crew_json || '[]')),
    rating: row.rating !== null && row.rating !== undefined ? Number(row.rating) : null,
    is_top_selling: Boolean(row.is_top_selling),
    status,
    created_at: row.created_at ? String(row.created_at) : undefined,
    availability: computeMovieAvailability(movieId, status, city),
  };
}

export function hydrateBookingRow(row: Record<string, unknown>): BookingRecord {
  return {
    id: String(row.id),
    booking_code: String(row.booking_code),
    user_id: row.user_id ? String(row.user_id) : null,
    customer_name: String(row.customer_name),
    customer_mobile: String(row.customer_mobile),
    customer_email: String(row.customer_email || ''),
    movie_id: String(row.movie_id),
    movie_title: String(row.movie_title || ''),
    movie_poster: String(row.movie_poster || ''),
    movie_certification: String(row.movie_certification || ''),
    movie_language: String(row.movie_language || ''),
    theatre_id: String(row.theatre_id),
    theatre_name: String(row.theatre_name || ''),
    theatre_address: String(row.theatre_address || ''),
    theatre_is_cancellable: Boolean(row.theatre_is_cancellable),
    screen_id: String(row.screen_id),
    screen_name: String(row.screen_name || ''),
    screen_number: Number(row.screen_number || 1),
    show_id: String(row.show_id),
    show_date: String(row.show_date),
    show_time: String(row.show_time),
    seats: JSON.parse(String(row.seats_json || '[]')),
    seat_count: Number(row.seat_count),
    subtotal: Number(row.subtotal),
    discount_amount: Number(row.discount_amount || 0),
    offer_code: row.offer_code ? String(row.offer_code) : null,
    convenience_fee: Number(row.convenience_fee || 0),
    tax_amount: Number(row.tax_amount || 0),
    total_amount: Number(row.total_amount),
    payment_status: String(row.payment_status) as BookingRecord['payment_status'],
    booking_status: String(row.booking_status) as BookingRecord['booking_status'],
    qr_payload: String(row.qr_payload),
    transaction_id: row.transaction_id ? String(row.transaction_id) : null,
    payment_gateway: row.payment_gateway ? String(row.payment_gateway) : null,
    created_at: String(row.created_at),
    cancelled_at: row.cancelled_at ? String(row.cancelled_at) : null,
    cancellation_reason: row.cancellation_reason ? String(row.cancellation_reason) : null,
  };
}

export function logAudit(
  admin: AuthUser,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown> = {}
): void {
  db.prepare(
    `INSERT INTO audit_logs (id, admin_user_id, admin_name, admin_role, action, entity_type, entity_id, details_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(uid('aud'), admin.id, admin.name, admin.role, action, entityType, entityId, JSON.stringify(details));
}

export function getUserByToken(token?: string | null): AuthUser | null {
  if (!token) return null;
  const nowIso = new Date().toISOString();
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.mobile, u.role, u.assigned_theatre_id, u.city, u.status, u.created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ? AND u.status = 'ACTIVE'`
    )
    .get(token, nowIso) as AuthUser | undefined;
  return row ?? null;
}

export function canAccessRole(userRole: UserRole, allowed: UserRole[]): boolean {
  if (userRole === 'SUPER_ADMIN') return true;
  return allowed.includes(userRole);
}

export function formatBookingWindowsWithLabels(): BookingWindow[] {
  const rows = db.prepare('SELECT * FROM booking_windows ORDER BY scope_type, updated_at DESC').all() as RawWindow[];
  return rows.map((r) => {
    let label = 'All Movies & Shows (Global Default)';
    if (r.scope_type === 'MOVIE') {
      const m = db.prepare('SELECT title FROM movies WHERE id = ?').get(r.scope_id) as { title: string } | undefined;
      label = m ? m.title : r.scope_id;
    } else if (r.scope_type === 'SHOW') {
      const s = db
        .prepare(
          `SELECT s.show_date, s.start_time, m.title, t.name as tname
           FROM shows s JOIN movies m ON m.id = s.movie_id JOIN theatres t ON t.id = s.theatre_id
           WHERE s.id = ?`
        )
        .get(r.scope_id) as { show_date: string; start_time: string; title: string; tname: string } | undefined;
      label = s ? `${s.title} · ${s.show_date} ${s.start_time} (${s.tname})` : r.scope_id;
    }
    return {
      id: r.id,
      scope_type: r.scope_type,
      scope_id: r.scope_id,
      scope_label: label,
      booking_open_at: r.booking_open_at,
      booking_close_at: r.booking_close_at,
      advance_enabled: Boolean(r.advance_enabled),
      max_advance_days: Number(r.max_advance_days),
      advance_start_date: r.advance_start_date,
      advance_end_date: r.advance_end_date,
      status: r.status,
      announcement_text: r.announcement_text,
    };
  });
}

export function hydrateShowWithMetrics(row: Record<string, unknown>): Show {
  const showObj = {
    id: String(row.id),
    movie_id: String(row.movie_id),
    movie_title: row.movie_title ? String(row.movie_title) : undefined,
    movie_poster: row.movie_poster ? String(row.movie_poster) : undefined,
    theatre_id: String(row.theatre_id),
    theatre_name: row.theatre_name ? String(row.theatre_name) : undefined,
    theatre_address: row.theatre_address ? String(row.theatre_address) : undefined,
    theatre_city: row.theatre_city ? String(row.theatre_city) : undefined,
    theatre_distance_km: row.theatre_distance_km !== undefined ? Number(row.theatre_distance_km) : undefined,
    theatre_is_cancellable: row.theatre_is_cancellable !== undefined ? Boolean(row.theatre_is_cancellable) : undefined,
    theatre_cancellation_policy: row.theatre_cancellation_policy ? String(row.theatre_cancellation_policy) : undefined,
    theatre_logo_code: row.theatre_logo_code ? String(row.theatre_logo_code) : undefined,
    theatre_facilities: row.theatre_facilities_json ? JSON.parse(String(row.theatre_facilities_json)) : undefined,
    screen_id: String(row.screen_id),
    screen_name: row.screen_name ? String(row.screen_name) : undefined,
    screen_number: row.screen_number !== undefined ? Number(row.screen_number) : undefined,
    show_date: String(row.show_date),
    start_time: String(row.start_time),
    end_time: String(row.end_time),
    language: String(row.language),
    format: String(row.format),
    sound_system: String(row.sound_system),
    status: String(row.status) as Show['status'],
    booking_open_at: row.booking_open_at ? String(row.booking_open_at) : null,
    booking_close_at: row.booking_close_at ? String(row.booking_close_at) : null,
  };

  return {
    ...showObj,
    metrics: computeShowMetrics(showObj),
  };
}
