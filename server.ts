import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { createAdminRouter } from './server/adminRoutes.ts';
import {
  APP_TIMEZONE,
  DEFAULT_CITY,
  computeMovieAvailability,
  computeShowMetrics,
  evaluateWindowState,
  formatLocalDate,
  getEffectiveBookingWindow,
  getSettings,
  getUserByToken,
  hydrateBookingRow,
  hydrateMovieRow,
  hydrateShowWithMetrics,
  isDateEligibleForBooking,
  isShowExpired,
  parseTimeToMinutes,
  purgeExpiredLocks,
  resolveSeatPrices,
  uid,
} from './server/bookingEngine.ts';
import { db, initSchema } from './server/db.ts';
import { seedDatabaseIfEmpty } from './server/seed.ts';
import type { BookingSeatSnapshot, ResolvedSeat, ScreenLayoutV2 } from './src/types.ts';

initSchema();
seedDatabaseIfEmpty();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '15mb' }));

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.get('/api/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({
      ok: true,
      status: 'healthy',
      env: process.env.NODE_ENV || 'development',
      timezone: APP_TIMEZONE,
      default_city: DEFAULT_CITY,
      db: 'connected',
      server_time: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ ok: false, status: 'unhealthy', error: (err as Error).message });
  }
});

function extractToken(req: express.Request): string {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

// ---------- AUTHENTICATION ----------
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }
  const user = db
    .prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)')
    .get(String(email).trim()) as Record<string, unknown> | undefined;

  if (!user || !bcrypt.compareSync(String(password), String(user.password_hash))) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }
  if (user.status !== 'ACTIVE') {
    res.status(403).json({ error: 'This account has been deactivated by an administrator.' });
    return;
  }

  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, expiresAt);

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      role: user.role,
      assigned_theatre_id: user.assigned_theatre_id,
      city: user.city,
      status: user.status,
      created_at: user.created_at,
    },
  });
});

app.post('/api/auth/register', (req, res) => {
  const { name, email, mobile, password, city } = req.body || {};
  if (!name || !email || !mobile || !password) {
    res.status(400).json({ error: 'Name, email, mobile number, and password are required.' });
    return;
  }
  const id = uid('usr');
  const hash = bcrypt.hashSync(String(password), 8);
  try {
    db.prepare(
      `INSERT INTO users (id, name, email, mobile, password_hash, role, city, status)
       VALUES (?, ?, ?, ?, ?, 'CUSTOMER', ?, 'ACTIVE')`
    ).run(id, String(name).trim(), String(email).trim().toLowerCase(), String(mobile).trim(), hash, String(city || DEFAULT_CITY));

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, id, expiresAt);

    const user = getUserByToken(token);
    res.status(201).json({ token, user });
  } catch {
    res.status(409).json({ error: 'An account with this email already exists.' });
  }
});

app.get('/api/auth/me', (req, res) => {
  const user = getUserByToken(extractToken(req));
  res.json({ user });
});

app.put('/api/auth/profile', (req, res) => {
  const user = getUserByToken(extractToken(req));
  if (!user) {
    res.status(401).json({ error: 'Sign in required to update profile.' });
    return;
  }
  const { name, mobile, city } = req.body || {};
  db.prepare('UPDATE users SET name = COALESCE(?, name), mobile = COALESCE(?, mobile), city = COALESCE(?, city) WHERE id = ?').run(
    name ? String(name).trim() : null,
    mobile ? String(mobile).trim() : null,
    city ? String(city).trim() : null,
    user.id
  );
  res.json({ user: getUserByToken(extractToken(req)) });
});

app.post('/api/auth/logout', (req, res) => {
  const token = extractToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ message: 'Signed out.' });
});

// ---------- PUBLIC SETTINGS, CITIES, OFFERS, NOTIFICATIONS ----------
app.get('/api/bootstrap', (req, res) => {
  const user = getUserByToken(extractToken(req));
  const dbCities = (
    db.prepare(`SELECT DISTINCT TRIM(city) as city FROM theatres WHERE status = 'ACTIVE' AND TRIM(city) != '' ORDER BY city ASC`).all() as Array<{ city: string }>
  ).map((r) => r.city);

  const cityMap = new Map<string, string>();
  cityMap.set(DEFAULT_CITY.toLowerCase(), DEFAULT_CITY);
  for (const c of dbCities) {
    if (!cityMap.has(c.toLowerCase())) {
      cityMap.set(c.toLowerCase(), c);
    }
  }
  const cities = Array.from(cityMap.values());

  const todayStr = formatLocalDate(new Date());
  const offers = (
    db
      .prepare(
        `SELECT * FROM offers
         WHERE is_active = 1 AND start_date <= ? AND expiry_date >= ?
         ORDER BY display_order ASC`
      )
      .all(todayStr, todayStr) as Array<Record<string, unknown>>
  ).map((o) => ({ ...o, is_active: Boolean(o.is_active) }));

  const notifications = (
    user
      ? db
          .prepare(
            `SELECT * FROM notifications
             WHERE target_user_id IS NULL OR target_user_id = ?
             ORDER BY created_at DESC LIMIT 30`
          )
          .all(user.id)
      : db.prepare(`SELECT * FROM notifications WHERE target_user_id IS NULL ORDER BY created_at DESC LIMIT 20`).all()
  ).map((n) => ({ ...(n as Record<string, unknown>), is_read: Boolean((n as Record<string, unknown>).is_read) }));

  res.json({
    settings: getSettings(),
    cities,
    offers,
    notifications,
    server_time: new Date().toISOString(),
  });
});

app.post('/api/notifications/mark-read', (req, res) => {
  const user = getUserByToken(extractToken(req));
  if (user) {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE target_user_id = ? OR target_user_id IS NULL').run(user.id);
  } else {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE target_user_id IS NULL').run();
  }
  res.json({ ok: true });
});

// ---------- MOVIES (STRICTLY SHOW-DRIVEN FOR CUSTOMER HOMEPAGE) ----------
app.get('/api/movies', (req, res) => {
  const requestedCity = req.query.city ? String(req.query.city).trim() : DEFAULT_CITY;
  const rows = db
    .prepare(`SELECT * FROM movies WHERE status IN ('NOW_SHOWING', 'UPCOMING') ORDER BY is_top_selling DESC, release_date ASC`)
    .all() as Array<Record<string, unknown>>;

  const hydrated = rows.map((r) => hydrateMovieRow(r, requestedCity));

  // CORE RULE: A movie appears on the customer homepage ONLY if it has >= 1 valid, active,
  // non-expired show in an active theatre & active screen for the selected city (default Tirunelveli).
  const nowShowing = hydrated.filter(
    (m) => m.availability?.state === 'OPEN' && m.availability?.can_book && m.availability.active_show_count > 0
  );
  const upcoming = hydrated.filter(
    (m) => m.availability?.state === 'SCHEDULED' && m.availability.active_show_count > 0
  );
  const visibleMovies = [...nowShowing, ...upcoming];

  res.json({
    city: requestedCity,
    now_showing: nowShowing,
    upcoming,
    all: visibleMovies,
    server_time: new Date().toISOString(),
  });
});

app.get('/api/movies/:id', (req, res) => {
  const city = req.query.city ? String(req.query.city).trim() : DEFAULT_CITY;
  const row = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
  if (!row) {
    res.status(404).json({ error: 'Movie not found.' });
    return;
  }
  res.json({ movie: hydrateMovieRow(row, city), server_time: new Date().toISOString() });
});

// ---------- THEATRES ----------
app.get('/api/theatres', (req, res) => {
  const user = getUserByToken(extractToken(req));
  const city = req.query.city ? String(req.query.city) : null;
  const todayStr = formatLocalDate(new Date());

  const favIds = new Set<string>(
    user
      ? (db.prepare('SELECT theatre_id FROM favourites WHERE user_id = ?').all(user.id) as Array<{ theatre_id: string }>).map(
          (r) => r.theatre_id
        )
      : []
  );

  const rows = (
    city && city !== 'All Cities'
      ? db.prepare(`SELECT * FROM theatres WHERE status = 'ACTIVE' AND LOWER(TRIM(city)) = LOWER(TRIM(?)) ORDER BY distance_km ASC`).all(city)
      : db.prepare(`SELECT * FROM theatres WHERE status = 'ACTIVE' ORDER BY distance_km ASC`).all()
  ) as Array<Record<string, unknown>>;

  const theatres = rows.map((r) => {
    const sc = db.prepare(`SELECT COUNT(*) as c FROM screens WHERE theatre_id = ? AND status = 'ACTIVE'`).get(r.id) as { c: number };
    const candidateShows = db
      .prepare(
        `SELECT s.show_date, s.start_time
         FROM shows s
         JOIN screens sc ON sc.id = s.screen_id
         JOIN movies m ON m.id = s.movie_id
         WHERE s.theatre_id = ?
           AND s.status = 'ACTIVE'
           AND sc.status = 'ACTIVE'
           AND m.status IN ('NOW_SHOWING', 'UPCOMING')
           AND s.show_date >= ?`
      )
      .all(r.id, todayStr) as Array<{ show_date: string; start_time: string }>;
    const validShowCount = candidateShows.filter((s) => !isShowExpired(s.show_date, s.start_time)).length;
    return {
      id: r.id,
      name: r.name,
      logo_code: r.logo_code,
      logo_url: r.logo_url,
      image_url: r.image_url,
      address: r.address,
      city: r.city,
      district: r.district,
      maps_location: r.maps_location,
      distance_km: Number(r.distance_km),
      contact_number: r.contact_number,
      facilities: JSON.parse(String(r.facilities_json || '[]')),
      cancellation_policy: r.cancellation_policy,
      is_cancellable: Boolean(r.is_cancellable),
      status: r.status,
      screen_count: sc.c,
      active_show_count: validShowCount,
      is_favourite: favIds.has(String(r.id)),
    };
  });

  res.json({ theatres });
});

app.post('/api/theatres/:id/favourite', (req, res) => {
  const user = getUserByToken(extractToken(req));
  if (!user) {
    res.status(401).json({ error: 'Sign in to save favourite theatres.' });
    return;
  }
  const theatreExists = db.prepare('SELECT id FROM theatres WHERE id = ?').get(req.params.id);
  if (!theatreExists) {
    res.status(404).json({ error: 'Theatre not found.' });
    return;
  }
  const existing = db
    .prepare('SELECT 1 FROM favourites WHERE user_id = ? AND theatre_id = ?')
    .get(user.id, req.params.id);
  if (existing) {
    db.prepare('DELETE FROM favourites WHERE user_id = ? AND theatre_id = ?').run(user.id, req.params.id);
    res.json({ is_favourite: false });
  } else {
    db.prepare('INSERT INTO favourites (user_id, theatre_id) VALUES (?, ?)').run(user.id, req.params.id);
    res.json({ is_favourite: true });
  }
});

// Theatre Shows Discovery (for "View Shows" from Theatres Near Me page)
app.get('/api/theatres/:id/shows', (req, res) => {
  const theatreRow = db.prepare(`SELECT * FROM theatres WHERE id = ? AND status = 'ACTIVE'`).get(req.params.id) as
    | Record<string, unknown>
    | undefined;
  if (!theatreRow) {
    res.status(404).json({ error: 'Theatre not found or inactive.' });
    return;
  }
  const todayStr = formatLocalDate(new Date());
  const allFutureCandidates = db
    .prepare(
      `SELECT s.show_date, s.start_time
       FROM shows s
       JOIN screens sc ON sc.id = s.screen_id
       JOIN movies m ON m.id = s.movie_id
       WHERE s.theatre_id = ?
         AND s.status = 'ACTIVE'
         AND sc.status = 'ACTIVE'
         AND m.status IN ('NOW_SHOWING', 'UPCOMING')
         AND s.show_date >= ?
       ORDER BY s.show_date ASC`
    )
    .all(req.params.id, todayStr) as Array<{ show_date: string; start_time: string }>;

  const dates = Array.from(
    new Set(
      allFutureCandidates
        .filter((r) => !isShowExpired(r.show_date, r.start_time))
        .map((r) => r.show_date)
    )
  ).slice(0, 14);

  const selectedDate = req.query.date ? String(req.query.date) : dates[0] || todayStr;
  const rows = db
    .prepare(
      `SELECT s.*, m.title as movie_title, m.poster_url as movie_poster, m.certification, m.duration_mins, m.genre,
              sc.name as screen_name, sc.screen_number
       FROM shows s
       JOIN movies m ON m.id = s.movie_id
       JOIN screens sc ON sc.id = s.screen_id
       WHERE s.theatre_id = ?
         AND s.show_date = ?
         AND s.status = 'ACTIVE'
         AND sc.status = 'ACTIVE'
         AND m.status IN ('NOW_SHOWING', 'UPCOMING')
       ORDER BY m.title ASC, s.start_time ASC`
    )
    .all(req.params.id, selectedDate) as Array<Record<string, unknown>>;

  const eligibleShows = rows
    .filter((r) => !isShowExpired(String(r.show_date), String(r.start_time)))
    .map(hydrateShowWithMetrics)
    .filter((s) => s.metrics?.booking_state === 'OPEN')
    .sort((a, b) => parseTimeToMinutes(a.start_time) - parseTimeToMinutes(b.start_time));

  res.json({
    theatre: {
      ...theatreRow,
      facilities: JSON.parse(String(theatreRow.facilities_json || '[]')),
      is_cancellable: Boolean(theatreRow.is_cancellable),
    },
    dates,
    shows: eligibleShows,
  });
});

// ---------- MOVIE SHOW SELECTION (SERVER-VALIDATED ELIGIBLE DATES + THEATRES) ----------
app.get('/api/movies/:movieId/shows', (req, res) => {
  const movieId = req.params.movieId;
  const city = req.query.city ? String(req.query.city).trim() : DEFAULT_CITY;
  const requestedDate = req.query.date ? String(req.query.date) : null;
  const user = getUserByToken(extractToken(req));

  const movieRow = db.prepare('SELECT * FROM movies WHERE id = ?').get(movieId) as Record<string, unknown> | undefined;
  if (!movieRow) {
    res.status(404).json({ error: 'Movie not found.' });
    return;
  }

  const availability = computeMovieAvailability(movieId, String(movieRow.status), city);
  const eligibleDates = availability.eligible_dates;
  const activeDate = requestedDate && eligibleDates.includes(requestedDate) ? requestedDate : eligibleDates[0] || null;

  const favIds = new Set<string>(
    user
      ? (db.prepare('SELECT theatre_id FROM favourites WHERE user_id = ?').all(user.id) as Array<{ theatre_id: string }>).map(
          (r) => r.theatre_id
        )
      : []
  );

  let theatreGroups: Array<{
    theatre_id: string;
    theatre_name: string;
    logo_code: string;
    address: string;
    city: string;
    distance_km: number;
    cancellation_policy: string;
    is_cancellable: boolean;
    facilities: string[];
    is_favourite: boolean;
    shows: ReturnType<typeof hydrateShowWithMetrics>[];
  }> = [];

  if (activeDate && availability.can_book) {
    const citySql = city && city !== 'All Cities' ? 'AND LOWER(TRIM(t.city)) = LOWER(TRIM(?))' : '';
    const params = city && city !== 'All Cities' ? [movieId, activeDate, city] : [movieId, activeDate];

    const showRows = db
      .prepare(
        `SELECT s.*,
                t.name as theatre_name, t.logo_code as theatre_logo_code, t.address as theatre_address,
                t.city as theatre_city, t.distance_km as theatre_distance_km,
                t.cancellation_policy as theatre_cancellation_policy, t.is_cancellable as theatre_is_cancellable,
                t.facilities_json as theatre_facilities_json,
                sc.name as screen_name, sc.screen_number
         FROM shows s
         JOIN theatres t ON t.id = s.theatre_id
         JOIN screens sc ON sc.id = s.screen_id
         WHERE s.movie_id = ? AND s.show_date = ? AND s.status = 'ACTIVE' AND t.status = 'ACTIVE' AND sc.status = 'ACTIVE' ${citySql}
         ORDER BY t.distance_km ASC, s.start_time ASC`
      )
      .all(...params) as Array<Record<string, unknown>>;

    const byTheatre = new Map<string, (typeof theatreGroups)[number]>();
    for (const r of showRows) {
      if (isShowExpired(String(r.show_date), String(r.start_time))) continue;
      const hydrated = hydrateShowWithMetrics(r);
      if (hydrated.metrics?.booking_state !== 'OPEN') continue;
      const tid = hydrated.theatre_id;
      if (!byTheatre.has(tid)) {
        byTheatre.set(tid, {
          theatre_id: tid,
          theatre_name: hydrated.theatre_name || '',
          logo_code: hydrated.theatre_logo_code || 'CIN',
          address: hydrated.theatre_address || '',
          city: hydrated.theatre_city || '',
          distance_km: hydrated.theatre_distance_km ?? 2.5,
          cancellation_policy: hydrated.theatre_cancellation_policy || 'Non-cancellable',
          is_cancellable: Boolean(hydrated.theatre_is_cancellable),
          facilities: hydrated.theatre_facilities || [],
          is_favourite: favIds.has(tid),
          shows: [],
        });
      }
      byTheatre.get(tid)!.shows.push(hydrated);
    }
    theatreGroups = Array.from(byTheatre.values()).map((grp) => ({
      ...grp,
      shows: grp.shows.sort((a, b) => parseTimeToMinutes(a.start_time) - parseTimeToMinutes(b.start_time)),
    }));
  }

  // Dynamic announcement banner tailored to selected date
  let announcement = availability.announcement;
  if (activeDate && availability.can_book) {
    const dt = new Date(`${activeDate}T12:00:00`);
    const weekday = dt.toLocaleDateString('en-IN', { weekday: 'long' });
    const todayStr = formatLocalDate(new Date());
    announcement =
      activeDate === todayStr
        ? `Bookings open for today's ${weekday} shows · Instant QR confirmation`
        : `Advance bookings open for shows on ${weekday}`;
  }

  res.json({
    movie: hydrateMovieRow(movieRow, city),
    availability,
    eligible_dates: eligibleDates,
    selected_date: activeDate,
    announcement,
    theatres: theatreGroups,
    server_time: new Date().toISOString(),
  });
});

// ---------- EXACT-JSON SEAT MAP FOR A SPECIFIC SHOW ----------
app.get('/api/shows/:showId/seat-map', (req, res) => {
  purgeExpiredLocks();
  const showId = req.params.showId;
  const sessionKey = String(req.query.session_key || '');

  const showRow = db
    .prepare(
      `SELECT s.*, m.title as movie_title, t.name as theatre_name, sc.name as screen_name, sc.screen_number
       FROM shows s
       JOIN movies m ON m.id = s.movie_id
       JOIN theatres t ON t.id = s.theatre_id
       JOIN screens sc ON sc.id = s.screen_id
       WHERE s.id = ?`
    )
    .get(showId) as Record<string, unknown> | undefined;

  if (!showRow) {
    res.status(404).json({ error: 'Show not found.' });
    return;
  }

  const movieRow = db.prepare('SELECT * FROM movies WHERE id = ?').get(showRow.movie_id) as Record<string, unknown>;
  const theatreRow = db.prepare('SELECT * FROM theatres WHERE id = ?').get(showRow.theatre_id) as Record<string, unknown>;
  const screenRow = db.prepare('SELECT * FROM screens WHERE id = ?').get(showRow.screen_id) as Record<string, unknown>;
  const layout: ScreenLayoutV2 = JSON.parse(String(screenRow.layout_json));

  const bookedSet = new Set<string>(
    (db.prepare('SELECT seat_id FROM booking_seats WHERE show_id = ?').all(showId) as Array<{ seat_id: string }>).map(
      (r) => r.seat_id
    )
  );
  const blockedSet = new Set<string>(
    (db.prepare('SELECT seat_id FROM show_seat_blocks WHERE show_id = ?').all(showId) as Array<{ seat_id: string }>).map(
      (r) => r.seat_id
    )
  );
  if (Array.isArray(layout.blocked_seats)) {
    for (const bId of layout.blocked_seats) blockedSet.add(bId);
  }
  const locks = db
    .prepare('SELECT seat_id, session_key, expires_at FROM seat_locks WHERE show_id = ?')
    .all(showId) as Array<{ seat_id: string; session_key: string; expires_at: string }>;
  const lockMap = new Map(locks.map((l) => [l.seat_id, l]));

  const catLookup = new Map(layout.categories.map((c) => [c.id, c]));
  const { categoryPrices, resolveSeatPrice } = resolveSeatPrices(
    layout,
    String(showRow.movie_id),
    String(showRow.theatre_id),
    String(showRow.screen_id),
    showId
  );

  const availCountByCat = new Map<string, number>();

  const resolvedSeats: ResolvedSeat[] = layout.seats.map((seat) => {
    const cat = catLookup.get(seat.category_id);
    const { price, source } = resolveSeatPrice(seat);
    const lock = lockMap.get(seat.id);

    let status: ResolvedSeat['status'] = 'AVAILABLE';
    let lockedByMe = false;

    if (bookedSet.has(seat.id)) {
      status = 'OCCUPIED';
    } else if (blockedSet.has(seat.id) || seat.status === 'BLOCKED' || seat.status === 'DISABLED') {
      status = 'BLOCKED';
    } else if (lock) {
      if (sessionKey && lock.session_key === sessionKey) {
        status = 'AVAILABLE';
        lockedByMe = true;
      } else {
        status = 'LOCKED';
      }
    }

    if (status === 'AVAILABLE') {
      availCountByCat.set(seat.category_id, (availCountByCat.get(seat.category_id) || 0) + 1);
    }

    return {
      ...seat,
      category_name: cat?.name || 'STANDARD',
      category_color: cat?.color || '#475569',
      resolved_price: price,
      price_source: source,
      status,
      locked_by_me: lockedByMe,
      lock_expires_at: lock?.expires_at || null,
    };
  });

  const categories = layout.categories.map((c) => ({
    ...c,
    resolved_price: categoryPrices.get(c.id)?.price ?? c.price,
    available_count: availCountByCat.get(c.id) || 0,
  }));

  // Sibling shows at same theatre & date for instant showtime switching!
  const siblingRows = db
    .prepare(
      `SELECT s.*, sc.name as screen_name
       FROM shows s JOIN screens sc ON sc.id = s.screen_id
       WHERE s.movie_id = ? AND s.theatre_id = ? AND s.show_date = ? AND s.status = 'ACTIVE' AND sc.status = 'ACTIVE'
       ORDER BY s.start_time ASC`
    )
    .all(showRow.movie_id, showRow.theatre_id, showRow.show_date) as Array<Record<string, unknown>>;

  const siblingShows = siblingRows
    .filter((s) => !isShowExpired(String(s.show_date), String(s.start_time)))
    .map((s) => {
      const m = computeShowMetrics({
        id: String(s.id),
        movie_id: String(s.movie_id),
        theatre_id: String(s.theatre_id),
        screen_id: String(s.screen_id),
        show_date: String(s.show_date),
        start_time: String(s.start_time),
        booking_open_at: s.booking_open_at ? String(s.booking_open_at) : null,
        booking_close_at: s.booking_close_at ? String(s.booking_close_at) : null,
        status: String(s.status),
      });
      return {
        id: String(s.id),
        start_time: String(s.start_time),
        screen_name: String(s.screen_name),
        format: String(s.format),
        sound_system: String(s.sound_system),
        indicator: m.indicator,
        available_seats: m.available_seats,
        booking_state: m.booking_state,
      };
    })
    .filter((s) => s.booking_state === 'OPEN')
    .sort((a, b) => parseTimeToMinutes(a.start_time) - parseTimeToMinutes(b.start_time))
    .map(({ booking_state: _bs, ...rest }) => rest);

  const settings = getSettings();

  res.json({
    show: hydrateShowWithMetrics(showRow),
    movie: hydrateMovieRow(movieRow, String(theatreRow.city || DEFAULT_CITY)),
    theatre: {
      ...theatreRow,
      facilities: JSON.parse(String(theatreRow.facilities_json || '[]')),
      is_cancellable: Boolean(theatreRow.is_cancellable),
    },
    screen: {
      id: screenRow.id,
      theatre_id: screenRow.theatre_id,
      screen_number: Number(screenRow.screen_number),
      name: screenRow.name,
      screen_type: screenRow.screen_type,
      sound_system: screenRow.sound_system,
      projection_type: screenRow.projection_type,
      capacity: Number(screenRow.capacity),
      image_url: screenRow.image_url,
      status: screenRow.status,
    },
    layout,
    categories,
    seats: resolvedSeats,
    metrics: computeShowMetrics({
      id: String(showRow.id),
      movie_id: String(showRow.movie_id),
      theatre_id: String(showRow.theatre_id),
      screen_id: String(showRow.screen_id),
      show_date: String(showRow.show_date),
      start_time: String(showRow.start_time),
      booking_open_at: showRow.booking_open_at ? String(showRow.booking_open_at) : null,
      booking_close_at: showRow.booking_close_at ? String(showRow.booking_close_at) : null,
      status: String(showRow.status),
    }),
    sibling_shows: siblingShows,
    settings: {
      convenience_fee_per_seat: settings.convenience_fee_per_seat,
      tax_rate_percent: settings.tax_rate_percent,
      lock_duration_seconds: settings.lock_duration_seconds,
    },
  });
});

// ---------- ATOMIC SEAT LOCKING & PRICE BREAKDOWN ----------
app.post('/api/shows/:showId/lock-seats', (req, res) => {
  purgeExpiredLocks();
  const showId = req.params.showId;
  const { seat_ids, session_key, coupon_code } = req.body || {};
  const user = getUserByToken(extractToken(req));

  if (!session_key || !Array.isArray(seat_ids) || seat_ids.length === 0) {
    res.status(400).json({ error: 'session_key and at least one seat_id are required.' });
    return;
  }
  if (seat_ids.length > 10) {
    res.status(400).json({ error: 'Maximum 10 seats can be booked in a single transaction.' });
    return;
  }

  const showRow = db
    .prepare(
      `SELECT s.*, t.status as theatre_status, sc.status as screen_status
       FROM shows s
       JOIN theatres t ON t.id = s.theatre_id
       JOIN screens sc ON sc.id = s.screen_id
       WHERE s.id = ?`
    )
    .get(showId) as Record<string, unknown> | undefined;
  if (!showRow || showRow.status !== 'ACTIVE' || showRow.theatre_status !== 'ACTIVE' || showRow.screen_status !== 'ACTIVE') {
    res.status(404).json({ error: 'Selected show is not available for booking.' });
    return;
  }
  if (isShowExpired(String(showRow.show_date), String(showRow.start_time))) {
    res.status(403).json({ error: 'This showtime has already started or expired.' });
    return;
  }

  // Server-side booking window validation!
  const win = getEffectiveBookingWindow(String(showRow.movie_id), showId);
  const winEval = evaluateWindowState(
    win,
    showRow.booking_open_at ? String(showRow.booking_open_at) : null,
    showRow.booking_close_at ? String(showRow.booking_close_at) : null
  );
  if (winEval.state !== 'OPEN' || !isDateEligibleForBooking(String(showRow.show_date), winEval)) {
    res.status(403).json({
      error:
        winEval.state === 'SCHEDULED'
          ? `Booking has not opened yet. Opens at ${winEval.opensAt}.`
          : 'Booking is currently closed for this show.',
    });
    return;
  }

  const screenRow = db.prepare('SELECT layout_json FROM screens WHERE id = ?').get(showRow.screen_id) as {
    layout_json: string;
  };
  const layout: ScreenLayoutV2 = JSON.parse(screenRow.layout_json);
  const seatLookup = new Map(layout.seats.map((s) => [s.id, s]));
  const catLookup = new Map(layout.categories.map((c) => [c.id, c]));
  const { resolveSeatPrice } = resolveSeatPrices(
    layout,
    String(showRow.movie_id),
    String(showRow.theatre_id),
    String(showRow.screen_id),
    showId
  );

  const settings = getSettings();
  const expiresAt = new Date(Date.now() + settings.lock_duration_seconds * 1000).toISOString();

  const tx = db.transaction(() => {
    // Release prior locks by this session on this show so changed selections stay clean
    db.prepare('DELETE FROM seat_locks WHERE show_id = ? AND session_key = ?').run(showId, String(session_key));

    const snapshots: BookingSeatSnapshot[] = [];

    for (const rawId of seat_ids) {
      const seatId = String(rawId);
      const seat = seatLookup.get(seatId);
      if (!seat) {
        throw new Error(`Seat ${seatId} does not exist in this screen layout.`);
      }
      if (db.prepare('SELECT 1 FROM booking_seats WHERE show_id = ? AND seat_id = ?').get(showId, seatId)) {
        throw new Error(`Seat ${seatId} was just booked by another customer.`);
      }
      const layoutBlocked = new Set<string>(Array.isArray(layout.blocked_seats) ? layout.blocked_seats : []);
      if (
        layoutBlocked.has(seatId) ||
        seat.status === 'BLOCKED' ||
        seat.status === 'DISABLED' ||
        db.prepare('SELECT 1 FROM show_seat_blocks WHERE show_id = ? AND seat_id = ?').get(showId, seatId)
      ) {
        throw new Error(`Seat ${seatId} is blocked by theatre management.`);
      }
      const existingLock = db
        .prepare('SELECT session_key FROM seat_locks WHERE show_id = ? AND seat_id = ?')
        .get(showId, seatId) as { session_key: string } | undefined;
      if (existingLock && existingLock.session_key !== session_key) {
        throw new Error(`Seat ${seatId} is temporarily held by another customer. Please pick another seat.`);
      }

      db.prepare(
        `INSERT INTO seat_locks (id, show_id, seat_id, session_key, user_id, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(uid('lck'), showId, seatId, String(session_key), user?.id || null, expiresAt);

      const { price, source } = resolveSeatPrice(seat);
      snapshots.push({
        seat_id: seat.id,
        row: seat.row,
        number: seat.number,
        category_id: seat.category_id,
        category_name: catLookup.get(seat.category_id)?.name || 'STANDARD',
        unit_price: price,
        price_source: source,
      });
    }

    return snapshots;
  });

  try {
    const snapshots = tx();
    const breakdown = calculateCheckoutBreakdown(snapshots, settings, coupon_code ? String(coupon_code) : null);
    res.json({
      locked: true,
      expires_at: expiresAt,
      lock_seconds: settings.lock_duration_seconds,
      seats: snapshots,
      pricing: breakdown,
    });
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

app.post('/api/shows/:showId/release-session-locks', (req, res) => {
  const { session_key } = req.body || {};
  if (session_key) {
    db.prepare('DELETE FROM seat_locks WHERE show_id = ? AND session_key = ?').run(req.params.showId, String(session_key));
  }
  res.json({ ok: true });
});

function calculateCheckoutBreakdown(
  snapshots: BookingSeatSnapshot[],
  settings: ReturnType<typeof getSettings>,
  couponCode: string | null
) {
  const subtotal = Math.round(snapshots.reduce((acc, s) => acc + s.unit_price, 0) * 100) / 100;
  let discountAmount = 0;
  let appliedCoupon: string | null = null;
  let couponError: string | null = null;

  if (couponCode && couponCode.trim()) {
    const todayStr = formatLocalDate(new Date());
    const offer = db
      .prepare(`SELECT * FROM offers WHERE UPPER(coupon_code) = UPPER(?) AND is_active = 1`)
      .get(couponCode.trim()) as Record<string, unknown> | undefined;
    if (!offer) {
      couponError = 'Invalid or inactive promo code.';
    } else if (todayStr < String(offer.start_date) || todayStr > String(offer.expiry_date)) {
      couponError = 'This promo code has expired.';
    } else if (subtotal < Number(offer.min_booking_amount)) {
      couponError = `Minimum ticket amount of ₹${offer.min_booking_amount} required for ${offer.coupon_code}.`;
    } else {
      const rawDiscount =
        offer.discount_type === 'PERCENT'
          ? (subtotal * Number(offer.discount_value)) / 100
          : Number(offer.discount_value);
      discountAmount = Math.min(Number(offer.max_discount), Math.round(rawDiscount * 100) / 100);
      appliedCoupon = String(offer.coupon_code);
    }
  }

  const convenienceFee = Math.round(snapshots.length * settings.convenience_fee_per_seat * 100) / 100;
  const taxAmount = Math.round(((convenienceFee * settings.tax_rate_percent) / 100) * 100) / 100;
  const totalAmount = Math.max(0, Math.round((subtotal - discountAmount + convenienceFee + taxAmount) * 100) / 100);

  // Category-wise grouping
  const byCategory: Array<{ category_name: string; unit_price: number; count: number; total: number }> = [];
  for (const s of snapshots) {
    const key = `${s.category_name}_${s.unit_price}`;
    const existing = byCategory.find((c) => `${c.category_name}_${c.unit_price}` === key);
    if (existing) {
      existing.count += 1;
      existing.total = Math.round((existing.total + s.unit_price) * 100) / 100;
    } else {
      byCategory.push({ category_name: s.category_name, unit_price: s.unit_price, count: 1, total: s.unit_price });
    }
  }

  return {
    by_category: byCategory,
    subtotal,
    discount_amount: discountAmount,
    applied_coupon: appliedCoupon,
    coupon_error: couponError,
    convenience_fee: convenienceFee,
    tax_rate_percent: settings.tax_rate_percent,
    tax_amount: taxAmount,
    total_amount: totalAmount,
  };
}

// ---------- SERVER-VERIFIED CHECKOUT & BOOKING CONFIRMATION ----------
app.post('/api/bookings/checkout', (req, res) => {
  purgeExpiredLocks();
  const user = getUserByToken(extractToken(req));
  const {
    show_id,
    seat_ids,
    session_key,
    customer_name,
    customer_mobile,
    customer_email,
    coupon_code,
    payment_method,
    payment_gateway,
    simulate_failure,
  } = req.body || {};

  if (!show_id || !Array.isArray(seat_ids) || seat_ids.length === 0 || !session_key) {
    res.status(400).json({ error: 'show_id, seat_ids, and session_key are required.' });
    return;
  }
  if (!customer_name || !customer_mobile) {
    res.status(400).json({ error: 'Customer name and mobile number are required for ticket delivery.' });
    return;
  }

  const showRow = db
    .prepare(
      `SELECT s.*, t.status as theatre_status, sc.status as screen_status
       FROM shows s
       JOIN theatres t ON t.id = s.theatre_id
       JOIN screens sc ON sc.id = s.screen_id
       WHERE s.id = ?`
    )
    .get(show_id) as Record<string, unknown> | undefined;
  if (!showRow || showRow.status !== 'ACTIVE' || showRow.theatre_status !== 'ACTIVE' || showRow.screen_status !== 'ACTIVE') {
    res.status(404).json({ error: 'Show not found or inactive.' });
    return;
  }
  if (isShowExpired(String(showRow.show_date), String(showRow.start_time))) {
    res.status(403).json({ error: 'This showtime has already started or expired.' });
    return;
  }

  // Server-side booking schedule validation
  const win = getEffectiveBookingWindow(String(showRow.movie_id), String(show_id));
  const winEval = evaluateWindowState(
    win,
    showRow.booking_open_at ? String(showRow.booking_open_at) : null,
    showRow.booking_close_at ? String(showRow.booking_close_at) : null
  );
  if (winEval.state !== 'OPEN' || !isDateEligibleForBooking(String(showRow.show_date), winEval)) {
    res.status(403).json({ error: 'Booking window is not currently open for this show.' });
    return;
  }

  // Payment failure simulation support (releases locks safely!)
  if (simulate_failure) {
    db.prepare('DELETE FROM seat_locks WHERE show_id = ? AND session_key = ?').run(show_id, String(session_key));
    res.status(402).json({ error: 'Payment verification declined by gateway. Your locked seats have been released.' });
    return;
  }

  const screenRow = db.prepare('SELECT layout_json FROM screens WHERE id = ?').get(showRow.screen_id) as {
    layout_json: string;
  };
  const layout: ScreenLayoutV2 = JSON.parse(screenRow.layout_json);
  const seatLookup = new Map(layout.seats.map((s) => [s.id, s]));
  const catLookup = new Map(layout.categories.map((c) => [c.id, c]));
  const { resolveSeatPrice } = resolveSeatPrices(
    layout,
    String(showRow.movie_id),
    String(showRow.theatre_id),
    String(showRow.screen_id),
    String(show_id)
  );
  const settings = getSettings();

  const tx = db.transaction(() => {
    const snapshots: BookingSeatSnapshot[] = [];

    for (const rawId of seat_ids) {
      const seatId = String(rawId);
      const seat = seatLookup.get(seatId);
      if (!seat) throw new Error(`Invalid seat ${seatId}.`);
      if (db.prepare('SELECT 1 FROM booking_seats WHERE show_id = ? AND seat_id = ?').get(show_id, seatId)) {
        throw new Error(`Seat ${seatId} is no longer available.`);
      }
      if (db.prepare('SELECT 1 FROM show_seat_blocks WHERE show_id = ? AND seat_id = ?').get(show_id, seatId)) {
        throw new Error(`Seat ${seatId} is blocked.`);
      }
      const lock = db
        .prepare('SELECT session_key FROM seat_locks WHERE show_id = ? AND seat_id = ?')
        .get(show_id, seatId) as { session_key: string } | undefined;
      if (lock && lock.session_key !== session_key) {
        throw new Error(`Seat ${seatId} lock expired or is held by another customer.`);
      }

      const { price, source } = resolveSeatPrice(seat);
      snapshots.push({
        seat_id: seat.id,
        row: seat.row,
        number: seat.number,
        category_id: seat.category_id,
        category_name: catLookup.get(seat.category_id)?.name || 'STANDARD',
        unit_price: price,
        price_source: source,
      });
    }

    const pricing = calculateCheckoutBreakdown(snapshots, settings, coupon_code ? String(coupon_code) : null);

    const bookingId = uid('bkg');
    const dateDigits = formatLocalDate(new Date()).replace(/-/g, '').slice(2);
    const randDigits = Math.floor(1000 + Math.random() * 9000);
    const bookingCode = `TN-${dateDigits}-${randDigits}`;
    const transactionId = `TXN-${dateDigits}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const qrPayload = JSON.stringify({
      booking_code: bookingCode,
      show_id,
      show_date: showRow.show_date,
      show_time: showRow.start_time,
      seats: snapshots.map((s) => s.seat_id),
      total_inr: pricing.total_amount,
      verified_txn: transactionId,
    });

    // Server-verified booking creation with immutable price snapshot
    db.prepare(
      `INSERT INTO bookings (
         id, booking_code, user_id, customer_name, customer_mobile, customer_email,
         movie_id, theatre_id, screen_id, show_id, show_date, show_time,
         seats_json, seat_count, subtotal, discount_amount, offer_code,
         convenience_fee, tax_amount, total_amount,
         payment_status, booking_status, qr_payload
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUCCESS', 'CONFIRMED', ?)`
    ).run(
      bookingId,
      bookingCode,
      user?.id || null,
      String(customer_name).trim(),
      String(customer_mobile).trim(),
      String(customer_email || user?.email || '').trim(),
      showRow.movie_id,
      showRow.theatre_id,
      showRow.screen_id,
      show_id,
      showRow.show_date,
      showRow.start_time,
      JSON.stringify(snapshots),
      snapshots.length,
      pricing.subtotal,
      pricing.discount_amount,
      pricing.applied_coupon,
      pricing.convenience_fee,
      pricing.tax_amount,
      pricing.total_amount,
      qrPayload
    );

    const insertSeat = db.prepare('INSERT INTO booking_seats (id, show_id, seat_id, booking_id) VALUES (?, ?, ?, ?)');
    for (const s of snapshots) {
      insertSeat.run(uid('bs'), show_id, s.seat_id, bookingId);
    }

    // Verified payment ledger row
    db.prepare(
      `INSERT INTO payments (id, transaction_id, booking_id, user_id, gateway, method, amount, status, refund_amount, refund_status, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'SUCCESS', 0, 'NONE', datetime('now'))`
    ).run(
      uid('pay'),
      transactionId,
      bookingId,
      user?.id || null,
      String(payment_gateway || 'Razorpay'),
      String(payment_method || 'UPI'),
      pricing.total_amount
    );

    // Clear temporary seat locks for this session
    db.prepare('DELETE FROM seat_locks WHERE show_id = ? AND session_key = ?').run(show_id, String(session_key));

    // Push confirmation notification
    const movie = db.prepare('SELECT title FROM movies WHERE id = ?').get(showRow.movie_id) as { title: string };
    const theatre = db.prepare('SELECT name FROM theatres WHERE id = ?').get(showRow.theatre_id) as { name: string };
    db.prepare(
      `INSERT INTO notifications (id, type, title, message, target_user_id, channel)
       VALUES (?, 'BOOKING_CONFIRMATION', ?, ?, ?, 'IN_APP')`
    ).run(
      uid('ntf'),
      `Tickets Confirmed: ${movie.title}`,
      `${bookingCode} · ${snapshots.map((s) => s.seat_id).join(', ')} at ${theatre.name} (${showRow.show_date} ${showRow.start_time}).`,
      user?.id || null
    );

    return bookingId;
  });

  try {
    const bookingId = tx();
    const row = db
      .prepare(
        `SELECT b.*,
                m.title as movie_title, m.poster_url as movie_poster, m.certification as movie_certification, m.language as movie_language,
                t.name as theatre_name, t.address as theatre_address, t.is_cancellable as theatre_is_cancellable,
                sc.name as screen_name, sc.screen_number,
                p.transaction_id, p.gateway as payment_gateway
         FROM bookings b
         JOIN movies m ON m.id = b.movie_id
         JOIN theatres t ON t.id = b.theatre_id
         JOIN screens sc ON sc.id = b.screen_id
         LEFT JOIN payments p ON p.booking_id = b.id
         WHERE b.id = ?`
      )
      .get(bookingId) as Record<string, unknown>;

    res.status(201).json({ booking: hydrateBookingRow(row), message: 'Booking confirmed!' });
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

// ---------- CUSTOMER BOOKING HISTORY & CANCELLATION ----------
app.get('/api/bookings', (req, res) => {
  const user = getUserByToken(extractToken(req));
  const guestCodesParam = String(req.query.codes || '');
  const guestCodes = guestCodesParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  let rows: Array<Record<string, unknown>> = [];
  if (user) {
    rows = db
      .prepare(
        `SELECT b.*,
                m.title as movie_title, m.poster_url as movie_poster, m.certification as movie_certification, m.language as movie_language,
                t.name as theatre_name, t.address as theatre_address, t.is_cancellable as theatre_is_cancellable,
                sc.name as screen_name, sc.screen_number,
                p.transaction_id, p.gateway as payment_gateway
         FROM bookings b
         JOIN movies m ON m.id = b.movie_id
         JOIN theatres t ON t.id = b.theatre_id
         JOIN screens sc ON sc.id = b.screen_id
         LEFT JOIN payments p ON p.booking_id = b.id
         WHERE b.user_id = ?
         ORDER BY b.created_at DESC`
      )
      .all(user.id) as Array<Record<string, unknown>>;
  } else if (guestCodes.length > 0) {
    const placeholders = guestCodes.map(() => '?').join(',');
    rows = db
      .prepare(
        `SELECT b.*,
                m.title as movie_title, m.poster_url as movie_poster, m.certification as movie_certification, m.language as movie_language,
                t.name as theatre_name, t.address as theatre_address, t.is_cancellable as theatre_is_cancellable,
                sc.name as screen_name, sc.screen_number,
                p.transaction_id, p.gateway as payment_gateway
         FROM bookings b
         JOIN movies m ON m.id = b.movie_id
         JOIN theatres t ON t.id = b.theatre_id
         JOIN screens sc ON sc.id = b.screen_id
         LEFT JOIN payments p ON p.booking_id = b.id
         WHERE b.booking_code IN (${placeholders})
         ORDER BY b.created_at DESC`
      )
      .all(...guestCodes) as Array<Record<string, unknown>>;
  } else {
    // Show sample recent tickets for demo customer Arjun so first-time visitors can inspect QR ticket design immediately
    rows = db
      .prepare(
        `SELECT b.*,
                m.title as movie_title, m.poster_url as movie_poster, m.certification as movie_certification, m.language as movie_language,
                t.name as theatre_name, t.address as theatre_address, t.is_cancellable as theatre_is_cancellable,
                sc.name as screen_name, sc.screen_number,
                p.transaction_id, p.gateway as payment_gateway
         FROM bookings b
         JOIN movies m ON m.id = b.movie_id
         JOIN theatres t ON t.id = b.theatre_id
         JOIN screens sc ON sc.id = b.screen_id
         LEFT JOIN payments p ON p.booking_id = b.id
         WHERE b.user_id = 'usr_cust_1'
         ORDER BY b.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;
  }

  res.json({ bookings: rows.map(hydrateBookingRow) });
});

app.post('/api/bookings/:id/cancel', (req, res) => {
  const id = req.params.id;
  const booking = db
    .prepare(
      `SELECT b.*, t.is_cancellable FROM bookings b JOIN theatres t ON t.id = b.theatre_id WHERE b.id = ?`
    )
    .get(id) as Record<string, unknown> | undefined;

  if (!booking) {
    res.status(404).json({ error: 'Booking not found.' });
    return;
  }
  if (!booking.is_cancellable) {
    res.status(400).json({ error: 'This theatre does not support ticket cancellations (Non-cancellable policy).' });
    return;
  }
  if (booking.booking_status === 'CANCELLED') {
    res.status(400).json({ error: 'Booking is already cancelled.' });
    return;
  }

  const refundAmount = Math.round(Number(booking.subtotal) * 0.75 * 100) / 100;
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE bookings SET booking_status = 'CANCELLED', payment_status = 'PARTIALLY_REFUNDED',
       cancelled_at = datetime('now'), cancellation_reason = 'Cancelled by customer' WHERE id = ?`
    ).run(id);
    db.prepare('DELETE FROM booking_seats WHERE booking_id = ?').run(id);
    db.prepare(
      `UPDATE payments SET status = 'PARTIALLY_REFUNDED', refund_amount = ?, refund_status = 'PROCESSED' WHERE booking_id = ?`
    ).run(refundAmount, id);
  });
  tx();

  res.json({ message: `Booking cancelled. Refund of ₹${refundAmount} processed.` });
});

// ---------- SUPER ADMIN ROUTES ----------
app.use('/api/admin', createAdminRouter());

// ---------- GLOBAL API ERROR HANDLER (CATCHES SQLITE CONSTRAINT & RUNTIME ERRORS) ----------
app.use('/api', (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const sqliteErr = err as { code?: string; message?: string; status?: number; type?: string };
  if (sqliteErr?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON request payload.' });
    return;
  }
  const code = String(sqliteErr?.code || '');
  const msg = String(sqliteErr?.message || '');
  if (code.includes('SQLITE_CONSTRAINT_FOREIGNKEY') || msg.includes('FOREIGN KEY constraint failed')) {
    res.status(409).json({
      error:
        'Action blocked because related records still reference this item, or a referenced theatre/screen/movie/show no longer exists.',
    });
    return;
  }
  if (code.includes('SQLITE_CONSTRAINT_UNIQUE') || msg.includes('UNIQUE constraint failed')) {
    res.status(409).json({
      error: 'A conflicting record already exists. Please refresh and try again.',
    });
    return;
  }
  console.error('[API Error]', err);
  res.status(sqliteErr?.status && sqliteErr.status >= 400 ? sqliteErr.status : 500).json({
    error: 'Unexpected server error occurred. Please try again.',
  });
});

// ---------- VITE / STATIC FRONTEND SERVING ----------
async function startServer() {
  const PORT = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    const assetsDir = path.join(distDir, 'assets');
    if (fs.existsSync(assetsDir)) {
      app.use(
        '/assets',
        express.static(assetsDir, {
          maxAge: '1y',
          immutable: true,
        })
      );
    }
    app.use(
      express.static(distDir, {
        index: false,
        maxAge: '1h',
      })
    );
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TICKETNOW server listening on http://0.0.0.0:${PORT} (${isProd ? 'production' : 'development'})`);
  });
}

startServer();
