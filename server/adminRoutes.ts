import bcrypt from 'bcryptjs';
import { Router, type NextFunction, type Request, type Response } from 'express';
import * as XLSX from 'xlsx';
import { db } from './db.ts';
import {
  canAccessRole,
  checkShowOverlap,
  computeShowMetrics,
  formatBookingWindowsWithLabels,
  formatLocalDate,
  getSettings,
  getUserByToken,
  hydrateBookingRow,
  hydrateMovieRow,
  hydrateShowWithMetrics,
  logAudit,
  purgeExpiredLocks,
  resolveSeatPrices,
  uid,
} from './bookingEngine.ts';
import { validateScreenLayoutJsonText, validateScreenLayoutV2 } from './layoutValidator.ts';
import type {
  AuthUser,
  BookingSeatSnapshot,
  BulkBookingRecord,
  BulkBookingTicket,
  ScreenLayoutV2,
  UserRole,
} from '../src/types.ts';

interface AdminRequest extends Request {
  adminUser?: AuthUser;
}

const ADMIN_ROLES: UserRole[] = ['SUPER_ADMIN', 'THEATRE_ADMIN', 'BOOKING_MANAGER', 'ACCOUNTANT'];

function requireAdmin(allowedRoles: UserRole[] = ADMIN_ROLES) {
  return (req: AdminRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const user = getUserByToken(token);
    if (!user || !ADMIN_ROLES.includes(user.role)) {
      res.status(401).json({ error: 'Admin authentication required.' });
      return;
    }
    if (!canAccessRole(user.role, allowedRoles)) {
      res.status(403).json({ error: `Role ${user.role} does not have permission for this module.` });
      return;
    }
    req.adminUser = user;
    next();
  };
}

export function createAdminRouter(): Router {
  const router = Router();

  // 1. DASHBOARD OVERVIEW & ANALYTICS
  router.get('/dashboard', requireAdmin(), (req: AdminRequest, res) => {
    purgeExpiredLocks();
    const admin = req.adminUser!;
    const range = String(req.query.range || '7d');
    const customFrom = String(req.query.from || '');
    const customTo = String(req.query.to || '');

    const now = new Date();
    const todayStr = formatLocalDate(now);
    let fromDate = todayStr;
    let toDate = todayStr;

    if (range === 'yesterday') {
      const y = new Date(now.getTime());
      y.setDate(y.getDate() - 1);
      fromDate = formatLocalDate(y);
      toDate = fromDate;
    } else if (range === '7d') {
      const d = new Date(now.getTime());
      d.setDate(d.getDate() - 6);
      fromDate = formatLocalDate(d);
    } else if (range === '30d') {
      const d = new Date(now.getTime());
      d.setDate(d.getDate() - 29);
      fromDate = formatLocalDate(d);
    } else if (range === 'custom' && customFrom && customTo) {
      fromDate = customFrom;
      toDate = customTo;
    }

    const theatreScope =
      admin.role === 'THEATRE_ADMIN' && admin.assigned_theatre_id ? admin.assigned_theatre_id : null;

    const totalTheatres = theatreScope
      ? 1
      : (db.prepare(`SELECT COUNT(*) as c FROM theatres`).get() as { c: number }).c;
    const totalScreens = theatreScope
      ? (db.prepare(`SELECT COUNT(*) as c FROM screens WHERE theatre_id = ?`).get(theatreScope) as { c: number }).c
      : (db.prepare(`SELECT COUNT(*) as c FROM screens`).get() as { c: number }).c;
    const totalMovies = (db.prepare(`SELECT COUNT(*) as c FROM movies`).get() as { c: number }).c;
    const nowShowingMovies = (
      db.prepare(`SELECT COUNT(*) as c FROM movies WHERE status = 'NOW_SHOWING'`).get() as { c: number }
    ).c;
    const upcomingMovies = (
      db.prepare(`SELECT COUNT(*) as c FROM movies WHERE status = 'UPCOMING'`).get() as { c: number }
    ).c;

    const todayShowsRows = (
      theatreScope
        ? db
            .prepare(`SELECT * FROM shows WHERE show_date = ? AND theatre_id = ? AND status = 'ACTIVE'`)
            .all(todayStr, theatreScope)
        : db.prepare(`SELECT * FROM shows WHERE show_date = ? AND status = 'ACTIVE'`).all(todayStr)
    ) as Array<{
      id: string;
      movie_id: string;
      theatre_id: string;
      screen_id: string;
      show_date: string;
      booking_open_at: string | null;
      booking_close_at: string | null;
      status: string;
    }>;

    let totalSeatsToday = 0;
    let availableSeatsToday = 0;
    let occupiedSeatsToday = 0;
    let blockedSeatsToday = 0;
    for (const sh of todayShowsRows) {
      const m = computeShowMetrics(sh);
      totalSeatsToday += m.total_seats;
      availableSeatsToday += m.available_seats;
      occupiedSeatsToday += m.booked_seats;
      blockedSeatsToday += m.blocked_seats;
    }

    const bookingFilterSql = theatreScope ? 'AND b.theatre_id = ?' : '';
    const bookingParams = theatreScope ? [theatreScope] : [];

    const totalBookings = (
      db
        .prepare(`SELECT COUNT(*) as c FROM bookings b WHERE b.booking_status = 'CONFIRMED' ${bookingFilterSql}`)
        .get(...bookingParams) as { c: number }
    ).c;

    const todaySalesRow = db
      .prepare(
        `SELECT COALESCE(SUM(seat_count), 0) as tickets, COALESCE(SUM(total_amount), 0) as revenue
         FROM bookings b
         WHERE b.booking_status = 'CONFIRMED' AND date(b.created_at) = date('now') ${bookingFilterSql}`
      )
      .get(...bookingParams) as { tickets: number; revenue: number };

    const rangeSalesRow = db
      .prepare(
        `SELECT COUNT(*) as bookings, COALESCE(SUM(seat_count), 0) as tickets, COALESCE(SUM(total_amount), 0) as revenue
         FROM bookings b
         WHERE b.booking_status = 'CONFIRMED'
           AND substr(b.created_at, 1, 10) >= ? AND substr(b.created_at, 1, 10) <= ?
           ${bookingFilterSql}`
      )
      .get(fromDate, toDate, ...bookingParams) as { bookings: number; tickets: number; revenue: number };

    // Daily revenue series
    const dailyRevenue = db
      .prepare(
        `SELECT substr(b.created_at, 1, 10) as date,
                COUNT(*) as bookings,
                COALESCE(SUM(b.seat_count), 0) as tickets,
                ROUND(COALESCE(SUM(b.total_amount), 0), 2) as revenue
         FROM bookings b
         WHERE b.booking_status = 'CONFIRMED'
           AND substr(b.created_at, 1, 10) >= ? AND substr(b.created_at, 1, 10) <= ?
           ${bookingFilterSql}
         GROUP BY substr(b.created_at, 1, 10)
         ORDER BY date ASC`
      )
      .all(fromDate, toDate, ...bookingParams);

    // Movie-wise collections
    const movieCollections = db
      .prepare(
        `SELECT m.id, m.title,
                COUNT(b.id) as bookings,
                COALESCE(SUM(b.seat_count), 0) as tickets,
                ROUND(COALESCE(SUM(b.total_amount), 0), 2) as revenue
         FROM movies m
         LEFT JOIN bookings b ON b.movie_id = m.id AND b.booking_status = 'CONFIRMED' ${bookingFilterSql}
         GROUP BY m.id
         ORDER BY revenue DESC`
      )
      .all(...bookingParams);

    // Theatre-wise collections
    const theatreCollections = db
      .prepare(
        `SELECT t.id, t.name, t.logo_code,
                COUNT(b.id) as bookings,
                COALESCE(SUM(b.seat_count), 0) as tickets,
                ROUND(COALESCE(SUM(b.total_amount), 0), 2) as revenue
         FROM theatres t
         LEFT JOIN bookings b ON b.theatre_id = t.id AND b.booking_status = 'CONFIRMED'
         ${theatreScope ? 'WHERE t.id = ?' : ''}
         GROUP BY t.id
         ORDER BY revenue DESC`
      )
      .all(...bookingParams);

    // Screen-wise occupancy for today
    const screenOccupancyMap = new Map<string, { screen: string; theatre: string; total: number; booked: number; blocked: number }>();
    const screenMeta = db
      .prepare(
        `SELECT sc.id, sc.name, t.logo_code
         FROM screens sc JOIN theatres t ON t.id = sc.theatre_id`
      )
      .all() as Array<{ id: string; name: string; logo_code: string }>;
    const metaById = new Map(screenMeta.map((s) => [s.id, s]));

    for (const sh of todayShowsRows) {
      const m = computeShowMetrics(sh);
      const info = metaById.get(sh.screen_id);
      const key = sh.screen_id;
      const cur = screenOccupancyMap.get(key) ?? {
        screen: `${info?.logo_code || ''} · ${info?.name || sh.screen_id}`,
        theatre: info?.logo_code || '',
        total: 0,
        booked: 0,
        blocked: 0,
      };
      cur.total += m.sellable_seats;
      cur.booked += m.booked_seats;
      cur.blocked += m.blocked_seats;
      screenOccupancyMap.set(key, cur);
    }

    const screenOccupancy = Array.from(screenOccupancyMap.values()).map((s) => ({
      ...s,
      occupancy_pct: s.total > 0 ? Math.round((s.booked / s.total) * 100) : 0,
    }));

    const upcomingShows = db
      .prepare(
        `SELECT s.*, m.title as movie_title, t.name as theatre_name, sc.name as screen_name, sc.screen_number
         FROM shows s
         JOIN movies m ON m.id = s.movie_id
         JOIN theatres t ON t.id = s.theatre_id
         JOIN screens sc ON sc.id = s.screen_id
         WHERE s.show_date >= ? AND s.status = 'ACTIVE' ${theatreScope ? 'AND s.theatre_id = ?' : ''}
         ORDER BY s.show_date ASC, s.start_time ASC
         LIMIT 10`
      )
      .all(...(theatreScope ? [todayStr, theatreScope] : [todayStr]))
      .map((r) => hydrateShowWithMetrics(r as Record<string, unknown>));

    res.json({
      kpis: {
        total_theatres: totalTheatres,
        total_screens: totalScreens,
        total_movies: totalMovies,
        now_showing_movies: nowShowingMovies,
        upcoming_movies: upcomingMovies,
        todays_shows: todayShowsRows.length,
        total_bookings: totalBookings,
        todays_tickets_sold: todaySalesRow.tickets,
        todays_revenue: Math.round(todaySalesRow.revenue * 100) / 100,
        range_bookings: rangeSalesRow.bookings,
        range_tickets: rangeSalesRow.tickets,
        range_revenue: Math.round(rangeSalesRow.revenue * 100) / 100,
        total_seats: totalSeatsToday,
        available_seats: availableSeatsToday,
        occupied_seats: occupiedSeatsToday,
        blocked_seats: blockedSeatsToday,
      },
      charts: {
        daily_revenue: dailyRevenue,
        movie_collections: movieCollections,
        theatre_collections: theatreCollections,
        screen_occupancy: screenOccupancy,
      },
      upcoming_shows: upcomingShows,
      date_range: { from: fromDate, to: toDate, range },
    });
  });

  // 2. THEATRE MANAGEMENT
  router.get('/theatres', requireAdmin(['SUPER_ADMIN', 'THEATRE_ADMIN', 'BOOKING_MANAGER', 'ACCOUNTANT']), (req: AdminRequest, res) => {
    const admin = req.adminUser!;
    const rows = (
      admin.role === 'THEATRE_ADMIN' && admin.assigned_theatre_id
        ? db.prepare('SELECT * FROM theatres WHERE id = ? ORDER BY name ASC').all(admin.assigned_theatre_id)
        : db.prepare('SELECT * FROM theatres ORDER BY created_at DESC').all()
    ) as Array<Record<string, unknown>>;

    const result = rows.map((r) => {
      const sc = db.prepare('SELECT COUNT(*) as c FROM screens WHERE theatre_id = ?').get(r.id) as { c: number };
      const sh = db.prepare(`SELECT COUNT(*) as c FROM shows WHERE theatre_id = ? AND status = 'ACTIVE'`).get(r.id) as { c: number };
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
        active_show_count: sh.c,
        created_at: r.created_at,
      };
    });
    res.json({ theatres: result });
  });

  router.post('/theatres', requireAdmin(['SUPER_ADMIN']), (req: AdminRequest, res) => {
    const b = req.body || {};
    if (!b.name || !b.address || !b.city) {
      res.status(400).json({ error: 'Theatre name, address, and city are required.' });
      return;
    }
    const id = uid('thr');
    const logoCode = String(b.logo_code || b.name.slice(0, 3)).toUpperCase().slice(0, 4);
    db.prepare(
      `INSERT INTO theatres (id, name, logo_code, logo_url, image_url, address, city, district, maps_location, distance_km, contact_number, facilities_json, cancellation_policy, is_cancellable, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      String(b.name).trim(),
      logoCode,
      b.logo_url || null,
      b.image_url || null,
      String(b.address).trim(),
      String(b.city).trim(),
      String(b.district || b.city).trim(),
      String(b.maps_location || '').trim(),
      Number(b.distance_km ?? 2.5),
      String(b.contact_number || '').trim(),
      JSON.stringify(Array.isArray(b.facilities) ? b.facilities : []),
      String(b.cancellation_policy || (b.is_cancellable ? 'Cancellable up to 2 hrs before show' : 'Non-cancellable')),
      b.is_cancellable ? 1 : 0,
      b.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'
    );
    logAudit(req.adminUser!, 'CREATE_THEATRE', 'theatre', id, { name: b.name });
    res.status(201).json({ id, message: 'Theatre created successfully.' });
  });

  router.put('/theatres/:id', requireAdmin(['SUPER_ADMIN', 'THEATRE_ADMIN']), (req: AdminRequest, res) => {
    const admin = req.adminUser!;
    const id = req.params.id;
    if (admin.role === 'THEATRE_ADMIN' && admin.assigned_theatre_id !== id) {
      res.status(403).json({ error: 'You can only edit your assigned theatre.' });
      return;
    }
    const b = req.body || {};
    db.prepare(
      `UPDATE theatres SET
        name = COALESCE(?, name),
        logo_code = COALESCE(?, logo_code),
        logo_url = ?,
        image_url = ?,
        address = COALESCE(?, address),
        city = COALESCE(?, city),
        district = COALESCE(?, district),
        maps_location = COALESCE(?, maps_location),
        distance_km = COALESCE(?, distance_km),
        contact_number = COALESCE(?, contact_number),
        facilities_json = COALESCE(?, facilities_json),
        cancellation_policy = COALESCE(?, cancellation_policy),
        is_cancellable = COALESCE(?, is_cancellable),
        status = COALESCE(?, status)
       WHERE id = ?`
    ).run(
      b.name ?? null,
      b.logo_code ? String(b.logo_code).toUpperCase().slice(0, 4) : null,
      b.logo_url ?? null,
      b.image_url ?? null,
      b.address ?? null,
      b.city ?? null,
      b.district ?? null,
      b.maps_location ?? null,
      b.distance_km !== undefined ? Number(b.distance_km) : null,
      b.contact_number ?? null,
      Array.isArray(b.facilities) ? JSON.stringify(b.facilities) : null,
      b.cancellation_policy ?? null,
      b.is_cancellable !== undefined ? (b.is_cancellable ? 1 : 0) : null,
      b.status ?? null,
      id
    );
    logAudit(admin, 'UPDATE_THEATRE', 'theatre', id, { status: b.status, name: b.name });
    res.json({ message: 'Theatre updated.' });
  });

  router.delete('/theatres/:id', requireAdmin(['SUPER_ADMIN']), (req: AdminRequest, res) => {
    const id = String(req.params.id || '').trim();
    const theatre = db.prepare('SELECT id, name FROM theatres WHERE id = ?').get(id) as
      | { id: string; name: string }
      | undefined;
    if (!theatre) {
      res.status(404).json({ error: 'Theatre not found.' });
      return;
    }

    const screensCount = (db.prepare('SELECT COUNT(*) as c FROM screens WHERE theatre_id = ?').get(id) as { c: number }).c;
    const showsCount = (db.prepare('SELECT COUNT(*) as c FROM shows WHERE theatre_id = ?').get(id) as { c: number }).c;
    const bookingsCount = (db.prepare('SELECT COUNT(*) as c FROM bookings WHERE theatre_id = ?').get(id) as { c: number }).c;
    const bulkBookingsCount = (
      db.prepare('SELECT COUNT(*) as c FROM bulk_bookings WHERE theatre_id = ?').get(id) as { c: number }
    ).c;

    if (screensCount > 0 || showsCount > 0 || bookingsCount > 0 || bulkBookingsCount > 0) {
      const parts: string[] = [];
      if (screensCount > 0) parts.push(`${screensCount} screen(s)`);
      if (showsCount > 0) parts.push(`${showsCount} show(s)`);
      if (bookingsCount > 0) parts.push(`${bookingsCount} booking record(s)`);
      if (bulkBookingsCount > 0) parts.push(`${bulkBookingsCount} bulk booking record(s)`);
      res.status(409).json({
        error: `Cannot delete "${theatre.name}" because it still has ${parts.join(', ')}. Set its status to INACTIVE instead to preserve historical records.`,
      });
      return;
    }

    const deleteTx = db.transaction(() => {
      db.prepare('DELETE FROM favourites WHERE theatre_id = ?').run(id);
      db.prepare('DELETE FROM movie_pricing WHERE theatre_id = ?').run(id);
      db.prepare('UPDATE users SET assigned_theatre_id = NULL WHERE assigned_theatre_id = ?').run(id);
      db.prepare('DELETE FROM theatres WHERE id = ?').run(id);
    });
    deleteTx();

    logAudit(req.adminUser!, 'DELETE_THEATRE', 'theatre', id, { name: theatre.name });
    res.json({ message: 'Theatre deleted.' });
  });

  // 3. SCREEN MANAGEMENT & 4. LAYOUT DESIGNER
  router.get('/screens', requireAdmin(['SUPER_ADMIN', 'THEATRE_ADMIN', 'BOOKING_MANAGER']), (req: AdminRequest, res) => {
    const admin = req.adminUser!;
    const theatreId = req.query.theatre_id ? String(req.query.theatre_id) : null;
    const scopedTheatre = admin.role === 'THEATRE_ADMIN' ? admin.assigned_theatre_id : theatreId;

    const rows = (
      scopedTheatre
        ? db
            .prepare(
              `SELECT sc.*, t.name as theatre_name FROM screens sc
               JOIN theatres t ON t.id = sc.theatre_id
               WHERE sc.theatre_id = ? ORDER BY sc.screen_number ASC`
            )
            .all(scopedTheatre)
        : db
            .prepare(
              `SELECT sc.*, t.name as theatre_name FROM screens sc
               JOIN theatres t ON t.id = sc.theatre_id
               ORDER BY t.name ASC, sc.screen_number ASC`
            )
            .all()
    ) as Array<Record<string, unknown>>;

    res.json({
      screens: rows.map((r) => ({
        id: r.id,
        theatre_id: r.theatre_id,
        theatre_name: r.theatre_name,
        screen_number: Number(r.screen_number),
        name: r.name,
        screen_type: r.screen_type,
        sound_system: r.sound_system,
        projection_type: r.projection_type,
        capacity: Number(r.capacity),
        image_url: r.image_url,
        status: r.status,
        layout: JSON.parse(String(r.layout_json)),
        updated_at: r.updated_at,
      })),
    });
  });

  router.post('/screens', requireAdmin(['SUPER_ADMIN', 'THEATRE_ADMIN']), (req: AdminRequest, res) => {
    const admin = req.adminUser!;
    const b = req.body || {};
    if (!b.theatre_id || !b.name || !b.screen_number) {
      res.status(400).json({ error: 'theatre_id, screen_number, and name are required.' });
      return;
    }
    if (admin.role === 'THEATRE_ADMIN' && admin.assigned_theatre_id !== b.theatre_id) {
      res.status(403).json({ error: 'Cannot create screen for another theatre.' });
      return;
    }
    const theatre = db.prepare('SELECT id, name FROM theatres WHERE id = ?').get(b.theatre_id) as
      | { id: string; name: string }
      | undefined;
    if (!theatre) {
      res.status(404).json({ error: 'Theatre not found.' });
      return;
    }

    const id = uid('scr');
    const defaultLayout: ScreenLayoutV2 = {
      schema_version: '2.0',
      theatre_id: theatre.id,
      theatre_name: theatre.name,
      screen_id: id,
      screen_name: String(b.name),
      screen_width: 820,
      screen_height: 480,
      screen_direction: 'BOTTOM',
      coordinate_system: 'cartesian_px',
      categories: [
        { id: 'cat_gold', name: 'GOLD', color: '#D97706', price: 170, rows: ['A', 'B', 'C'] },
        { id: 'cat_silver', name: 'SILVER', color: '#2563EB', price: 120, rows: ['D', 'E'] },
      ],
      rows: [
        { label: 'A', y: 60, category_id: 'cat_gold' },
        { label: 'B', y: 102, category_id: 'cat_gold' },
        { label: 'C', y: 144, category_id: 'cat_gold' },
        { label: 'D', y: 210, category_id: 'cat_silver' },
        { label: 'E', y: 252, category_id: 'cat_silver' },
      ],
      seats: ['A', 'B', 'C', 'D', 'E'].flatMap((rowLabel, rIdx) => {
        const y = rIdx < 3 ? 60 + rIdx * 42 : 210 + (rIdx - 3) * 42;
        const catId = rIdx < 3 ? 'cat_gold' : 'cat_silver';
        return Array.from({ length: 10 }, (_, idx) => ({
          id: `${rowLabel}${idx + 1}`,
          row: rowLabel,
          number: idx + 1,
          x: 120 + idx * 42 + (idx >= 5 ? 36 : 0),
          y,
          width: 32,
          height: 28,
          category_id: catId,
          seat_type: 'NORMAL' as const,
          block: idx < 5 ? ('LEFT' as const) : ('RIGHT' as const),
          price_override: null,
        }));
      }),
      aisles: [{ id: 'aisle_center', orientation: 'vertical', x: 330, y: 50, width: 28, height: 240, label: 'Center Aisle' }],
      blocked_seats: [],
    };

    const layoutToSave = b.layout ? b.layout : defaultLayout;
    const validation = validateScreenLayoutV2(layoutToSave);
    if (!validation.valid || !validation.normalized) {
      res.status(400).json({ error: 'Invalid screen layout JSON.', validation_errors: validation.errors });
      return;
    }

    db.prepare(
      `INSERT INTO screens (id, theatre_id, screen_number, name, screen_type, sound_system, projection_type, capacity, image_url, status, layout_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      theatre.id,
      Number(b.screen_number),
      String(b.name),
      String(b.screen_type || '2D / 4K'),
      String(b.sound_system || 'Dolby Atmos'),
      String(b.projection_type || '4K Laser'),
      validation.normalized.seats.length,
      b.image_url || null,
      b.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
      JSON.stringify(validation.normalized)
    );
    logAudit(admin, 'CREATE_SCREEN', 'screen', id, { theatre_id: theatre.id, name: b.name });
    res.status(201).json({ id, message: 'Screen created.' });
  });

  router.put('/screens/:id', requireAdmin(['SUPER_ADMIN', 'THEATRE_ADMIN']), (req: AdminRequest, res) => {
    const admin = req.adminUser!;
    const id = req.params.id;
    const existing = db.prepare('SELECT * FROM screens WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Screen not found.' });
      return;
    }
    if (admin.role === 'THEATRE_ADMIN' && admin.assigned_theatre_id !== existing.theatre_id) {
      res.status(403).json({ error: 'Cannot edit screen for another theatre.' });
      return;
    }

    const b = req.body || {};
    let layoutJson = String(existing.layout_json);
    let capacity = Number(existing.capacity);

    if (b.layout) {
      const validation = validateScreenLayoutV2(b.layout);
      if (!validation.valid || !validation.normalized) {
        res.status(400).json({ error: 'Layout JSON validation failed.', validation_errors: validation.errors });
        return;
      }
      layoutJson = JSON.stringify(validation.normalized);
      capacity = validation.normalized.seats.length;
    }

    db.prepare(
      `UPDATE screens SET
        screen_number = COALESCE(?, screen_number),
        name = COALESCE(?, name),
        screen_type = COALESCE(?, screen_type),
        sound_system = COALESCE(?, sound_system),
        projection_type = COALESCE(?, projection_type),
        capacity = ?,
        image_url = ?,
        status = COALESCE(?, status),
        layout_json = ?,
        updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      b.screen_number !== undefined ? Number(b.screen_number) : null,
      b.name ?? null,
      b.screen_type ?? null,
      b.sound_system ?? null,
      b.projection_type ?? null,
      capacity,
      b.image_url !== undefined ? b.image_url : existing.image_url,
      b.status ?? null,
      layoutJson,
      id
    );
    logAudit(admin, b.layout ? 'SAVE_SCREEN_LAYOUT' : 'UPDATE_SCREEN', 'screen', id, { capacity });
    res.json({ message: 'Screen updated successfully.', capacity });
  });

  router.post('/screens/:id/validate-layout', requireAdmin(['SUPER_ADMIN', 'THEATRE_ADMIN']), (req: AdminRequest, res) => {
    const admin = req.adminUser!;
    const screenId = req.params.id;
    const screen = db
      .prepare('SELECT id, theatre_id, name FROM screens WHERE id = ?')
      .get(screenId) as { id: string; theatre_id: string; name: string } | undefined;
    if (!screen) {
      res.status(404).json({ error: 'Selected screen not found.' });
      return;
    }
    if (admin.role === 'THEATRE_ADMIN' && admin.assigned_theatre_id !== screen.theatre_id) {
      res.status(403).json({ error: 'Cannot validate layout for another theatre.' });
      return;
    }

    const rawJson = typeof req.body?.raw_json === 'string' ? req.body.raw_json : '';
    const result = validateScreenLayoutJsonText(rawJson, { requireBlockedSeats: true });

    const warnings = [...result.warnings];
    if (result.valid && result.parsed) {
      if (result.parsed.screen_id !== screen.id) {
        warnings.push(
          `Uploaded JSON screen_id "${result.parsed.screen_id}" differs from currently selected screen "${screen.id}" (${screen.name}). Importing will only update "${screen.name}" and will not modify or delete any other screen.`
        );
      }
      if (result.parsed.theatre_id !== screen.theatre_id) {
        warnings.push(
          `Uploaded JSON theatre_id "${result.parsed.theatre_id}" differs from target theatre "${screen.theatre_id}". All seat coordinates, categories, prices, and fields from your file will be preserved verbatim.`
        );
      }
    }

    res.status(result.valid ? 200 : 400).json({
      ...result,
      warnings,
    });
  });

  router.post('/screens/:id/import-layout', requireAdmin(['SUPER_ADMIN', 'THEATRE_ADMIN']), (req: AdminRequest, res) => {
    const admin = req.adminUser!;
    const screenId = req.params.id;
    const screen = db
      .prepare('SELECT id, theatre_id, name FROM screens WHERE id = ?')
      .get(screenId) as { id: string; theatre_id: string; name: string } | undefined;
    if (!screen) {
      res.status(404).json({ error: 'Selected screen not found.' });
      return;
    }
    if (admin.role === 'THEATRE_ADMIN' && admin.assigned_theatre_id !== screen.theatre_id) {
      res.status(403).json({ error: 'Cannot import layout into another theatre.' });
      return;
    }

    const rawJson = typeof req.body?.raw_json === 'string' ? req.body.raw_json : '';
    const filename = typeof req.body?.filename === 'string' ? req.body.filename : 'uploaded.json';
    const result = validateScreenLayoutJsonText(rawJson, { requireBlockedSeats: true });

    if (!result.valid || !result.parsed) {
      res.status(400).json({
        error: 'JSON file validation failed. Please resolve all listed issues before importing.',
        issues: result.issues,
        validation_errors: result.errors,
      });
      return;
    }

    // CRITICAL: Preserve uploaded JSON verbatim without silently rewriting coordinates, IDs, categories, prices, or arrays
    const exactJson = JSON.stringify(result.parsed);
    const capacity = result.parsed.seats.length;

    db.prepare(
      `UPDATE screens
       SET layout_json = ?, capacity = ?, updated_at = datetime('now')
       WHERE id = ? AND theatre_id = ?`
    ).run(exactJson, capacity, screen.id, screen.theatre_id);

    logAudit(admin, 'IMPORT_SCREEN_LAYOUT_JSON', 'screen', screen.id, {
      filename,
      schema_version: result.parsed.schema_version,
      capacity,
      aisles: result.parsed.aisles.length,
      blocked_seats: Array.isArray(result.parsed.blocked_seats) ? result.parsed.blocked_seats.length : 0,
    });

    res.json({
      message: `Layout "${filename}" imported and saved to ${screen.name} (${capacity} seats preserved at exact JSON coordinates).`,
      capacity,
      layout: result.parsed,
    });
  });

  router.delete('/screens/:id', requireAdmin(['SUPER_ADMIN', 'THEATRE_ADMIN']), (req: AdminRequest, res) => {
    const admin = req.adminUser!;
    const id = String(req.params.id || '').trim();
    const screen = db.prepare('SELECT id, theatre_id, name FROM screens WHERE id = ?').get(id) as
      | { id: string; theatre_id: string; name: string }
      | undefined;
    if (!screen) {
      res.status(404).json({ error: 'Screen not found.' });
      return;
    }
    if (admin.role === 'THEATRE_ADMIN' && admin.assigned_theatre_id !== screen.theatre_id) {
      res.status(403).json({ error: 'Cannot delete a screen belonging to another theatre.' });
      return;
    }

    const showsCount = (db.prepare('SELECT COUNT(*) as c FROM shows WHERE screen_id = ?').get(id) as { c: number }).c;
    const bookingsCount = (db.prepare('SELECT COUNT(*) as c FROM bookings WHERE screen_id = ?').get(id) as { c: number }).c;
    const bulkBookingsCount = (
      db.prepare('SELECT COUNT(*) as c FROM bulk_bookings WHERE screen_id = ?').get(id) as { c: number }
    ).c;

    if (showsCount > 0 || bookingsCount > 0 || bulkBookingsCount > 0) {
      const parts: string[] = [];
      if (showsCount > 0) parts.push(`${showsCount} scheduled show(s)`);
      if (bookingsCount > 0) parts.push(`${bookingsCount} booking record(s)`);
      if (bulkBookingsCount > 0) parts.push(`${bulkBookingsCount} bulk booking record(s)`);
      res.status(409).json({
        error: `Cannot delete "${screen.name}" because it has ${parts.join(', ')}. Mark the screen INACTIVE instead to preserve booking records.`,
      });
      return;
    }

    const deleteTx = db.transaction(() => {
      db.prepare('DELETE FROM movie_pricing WHERE screen_id = ?').run(id);
      db.prepare('DELETE FROM screens WHERE id = ?').run(id);
    });
    deleteTx();

    logAudit(admin, 'DELETE_SCREEN', 'screen', id, { name: screen.name });
    res.json({ message: 'Screen deleted.' });
  });

  // 5. MOVIE MANAGEMENT
  router.get('/movies', requireAdmin(), (_req, res) => {
    const rows = db.prepare('SELECT * FROM movies ORDER BY created_at DESC').all() as Array<Record<string, unknown>>;
    res.json({ movies: rows.map((r) => hydrateMovieRow(r)) });
  });

  router.post('/movies', requireAdmin(['SUPER_ADMIN']), (req: AdminRequest, res) => {
    const b = req.body || {};
    if (!b.title || !b.language || !b.genre) {
      res.status(400).json({ error: 'Title, language, and genre are required.' });
      return;
    }
    const id = uid('mov');
    db.prepare(
      `INSERT INTO movies (id, title, language, genre, certification, duration_mins, release_date, poster_url, banner_url, trailer_url, description, cast_json, crew_json, rating, is_top_selling, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      String(b.title).trim(),
      String(b.language).trim(),
      String(b.genre).trim(),
      String(b.certification || 'U/A'),
      Number(b.duration_mins || 145),
      String(b.release_date || formatLocalDate(new Date())),
      String(b.poster_url || ''),
      b.banner_url || null,
      b.trailer_url || null,
      String(b.description || ''),
      JSON.stringify(Array.isArray(b.cast) ? b.cast : []),
      JSON.stringify(Array.isArray(b.crew) ? b.crew : []),
      b.rating !== undefined && b.rating !== '' && b.rating !== null ? Number(b.rating) : null,
      b.is_top_selling ? 1 : 0,
      b.status || 'NOW_SHOWING'
    );
    logAudit(req.adminUser!, 'CREATE_MOVIE', 'movie', id, { title: b.title });
    res.status(201).json({ id, message: 'Movie created.' });
  });

  router.put('/movies/:id', requireAdmin(['SUPER_ADMIN']), (req: AdminRequest, res) => {
    const id = req.params.id;
    const b = req.body || {};
    db.prepare(
      `UPDATE movies SET
        title = COALESCE(?, title),
        language = COALESCE(?, language),
        genre = COALESCE(?, genre),
        certification = COALESCE(?, certification),
        duration_mins = COALESCE(?, duration_mins),
        release_date = COALESCE(?, release_date),
        poster_url = COALESCE(?, poster_url),
        banner_url = ?,
        trailer_url = ?,
        description = COALESCE(?, description),
        cast_json = COALESCE(?, cast_json),
        crew_json = COALESCE(?, crew_json),
        rating = ?,
        is_top_selling = COALESCE(?, is_top_selling),
        status = COALESCE(?, status)
       WHERE id = ?`
    ).run(
      b.title ?? null,
      b.language ?? null,
      b.genre ?? null,
      b.certification ?? null,
      b.duration_mins !== undefined ? Number(b.duration_mins) : null,
      b.release_date ?? null,
      b.poster_url ?? null,
      b.banner_url ?? null,
      b.trailer_url ?? null,
      b.description ?? null,
      Array.isArray(b.cast) ? JSON.stringify(b.cast) : null,
      Array.isArray(b.crew) ? JSON.stringify(b.crew) : null,
      b.rating !== undefined && b.rating !== '' && b.rating !== null ? Number(b.rating) : null,
      b.is_top_selling !== undefined ? (b.is_top_selling ? 1 : 0) : null,
      b.status ?? null,
      id
    );
    logAudit(req.adminUser!, 'UPDATE_MOVIE', 'movie', id, { title: b.title, status: b.status });
    res.json({ message: 'Movie updated.' });
  });

  router.delete('/movies/:id', requireAdmin(['SUPER_ADMIN']), (req: AdminRequest, res) => {
    const id = String(req.params.id || '').trim();
    const movie = db.prepare('SELECT id, title FROM movies WHERE id = ?').get(id) as
      | { id: string; title: string }
      | undefined;
    if (!movie) {
      res.status(404).json({ error: 'Movie not found.' });
      return;
    }

    const showsCount = (db.prepare('SELECT COUNT(*) as c FROM shows WHERE movie_id = ?').get(id) as { c: number }).c;
    const bookingsCount = (db.prepare('SELECT COUNT(*) as c FROM bookings WHERE movie_id = ?').get(id) as { c: number }).c;
    const bulkBookingsCount = (
      db.prepare('SELECT COUNT(*) as c FROM bulk_bookings WHERE movie_id = ?').get(id) as { c: number }
    ).c;

    if (showsCount > 0 || bookingsCount > 0 || bulkBookingsCount > 0) {
      const parts: string[] = [];
      if (showsCount > 0) parts.push(`${showsCount} associated show(s)`);
      if (bookingsCount > 0) parts.push(`${bookingsCount} booking record(s)`);
      if (bulkBookingsCount > 0) parts.push(`${bulkBookingsCount} bulk booking record(s)`);
      res.status(409).json({
        error: `Cannot delete "${movie.title}" because it has ${parts.join(', ')}. Set status to COMPLETED or INACTIVE instead.`,
      });
      return;
    }

    const deleteTx = db.transaction(() => {
      db.prepare(`DELETE FROM booking_windows WHERE scope_type = 'MOVIE' AND scope_id = ?`).run(id);
      db.prepare('DELETE FROM movies WHERE id = ?').run(id);
    });
    deleteTx();

    logAudit(req.adminUser!, 'DELETE_MOVIE', 'movie', id, { title: movie.title });
    res.json({ message: 'Movie deleted.' });
  });

  // 6. DYNAMIC PRICING (MOVIE-WISE, THEATRE-WISE, SCREEN-WISE, SHOW-WISE)
  router.get('/pricing', requireAdmin(['SUPER_ADMIN', 'THEATRE_ADMIN']), (_req, res) => {
    const rules = db
      .prepare(
        `SELECT mp.*, m.title as movie_title, t.name as theatre_name, sc.name as screen_name
         FROM movie_pricing mp
         JOIN movies m ON m.id = mp.movie_id
         LEFT JOIN theatres t ON t.id = mp.theatre_id
         LEFT JOIN screens sc ON sc.id = mp.screen_id
         ORDER BY m.title ASC, mp.category_id ASC`
      )
      .all();

    // Also collect all known category definitions across all screen layouts
    const screens = db.prepare('SELECT id, name, theatre_id, layout_json FROM screens').all() as Array<{
      id: string;
      name: string;
      theatre_id: string;
      layout_json: string;
    }>;
    const catMap = new Map<string, { id: string; name: string; color: string; default_price: number; screens: string[] }>();
    for (const sc of screens) {
      const layout: ScreenLayoutV2 = JSON.parse(sc.layout_json);
      for (const c of layout.categories) {
        const prev = catMap.get(c.id);
        if (prev) {
          prev.screens.push(sc.name);
        } else {
          catMap.set(c.id, { id: c.id, name: c.name, color: c.color, default_price: c.price, screens: [sc.name] });
        }
      }
    }

    res.json({ rules, categories: Array.from(catMap.values()) });
  });

  router.post('/pricing', requireAdmin(['SUPER_ADMIN', 'THEATRE_ADMIN']), (req: AdminRequest, res) => {
    const b = req.body || {};
    const movieId = String(b.movie_id || '').trim();
    const categoryId = String(b.category_id || '').trim();
    if (!movieId || !categoryId || b.price === undefined) {
      res.status(400).json({ error: 'movie_id, category_id, and price are required.' });
      return;
    }
    const price = Number(b.price);
    if (Number.isNaN(price) || price < 0) {
      res.status(400).json({ error: 'Price must be a non-negative number.' });
      return;
    }

    const movieExists = db.prepare('SELECT id FROM movies WHERE id = ?').get(movieId);
    if (!movieExists) {
      res.status(404).json({ error: 'Selected movie was not found. Please refresh and choose a valid movie.' });
      return;
    }

    const theatreId = b.theatre_id ? String(b.theatre_id).trim() || null : null;
    const screenId = b.screen_id ? String(b.screen_id).trim() || null : null;
    const showId = b.show_id ? String(b.show_id).trim() || null : null;

    if (theatreId && !db.prepare('SELECT id FROM theatres WHERE id = ?').get(theatreId)) {
      res.status(404).json({ error: 'Selected theatre was not found.' });
      return;
    }
    if (screenId) {
      const screenRow = db.prepare('SELECT id, theatre_id FROM screens WHERE id = ?').get(screenId) as
        | { id: string; theatre_id: string }
        | undefined;
      if (!screenRow) {
        res.status(404).json({ error: 'Selected screen was not found.' });
        return;
      }
      if (theatreId && screenRow.theatre_id !== theatreId) {
        res.status(400).json({ error: 'Selected screen does not belong to the chosen theatre.' });
        return;
      }
    }
    if (showId && !db.prepare('SELECT id FROM shows WHERE id = ?').get(showId)) {
      res.status(404).json({ error: 'Selected show was not found.' });
      return;
    }

    // Upsert exact scope match so changing Movie A never affects Movie B
    const existing = db
      .prepare(
        `SELECT id FROM movie_pricing
         WHERE movie_id = ? AND category_id = ?
           AND COALESCE(theatre_id, '') = COALESCE(?, '')
           AND COALESCE(screen_id, '') = COALESCE(?, '')
           AND COALESCE(show_id, '') = COALESCE(?, '')`
      )
      .get(movieId, categoryId, theatreId, screenId, showId) as { id: string } | undefined;

    if (existing) {
      db.prepare(`UPDATE movie_pricing SET price = ?, updated_at = datetime('now') WHERE id = ?`).run(price, existing.id);
      logAudit(req.adminUser!, 'UPDATE_PRICING', 'movie_pricing', existing.id, { movie_id: movieId, category_id: categoryId, price });
      res.json({ id: existing.id, message: 'Pricing rule updated.' });
    } else {
      const id = uid('pr');
      db.prepare(
        `INSERT INTO movie_pricing (id, movie_id, theatre_id, screen_id, show_id, category_id, price)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(id, movieId, theatreId, screenId, showId, categoryId, price);
      logAudit(req.adminUser!, 'CREATE_PRICING', 'movie_pricing', id, { movie_id: movieId, category_id: categoryId, price });
      res.status(201).json({ id, message: 'Pricing rule created.' });
    }
  });

  router.delete('/pricing/:id', requireAdmin(['SUPER_ADMIN', 'THEATRE_ADMIN']), (req: AdminRequest, res) => {
    db.prepare('DELETE FROM movie_pricing WHERE id = ?').run(req.params.id);
    logAudit(req.adminUser!, 'DELETE_PRICING', 'movie_pricing', req.params.id);
    res.json({ message: 'Pricing override removed.' });
  });

  // 7. SHOW MANAGEMENT
  router.get('/shows', requireAdmin(['SUPER_ADMIN', 'THEATRE_ADMIN', 'BOOKING_MANAGER']), (req: AdminRequest, res) => {
    const admin = req.adminUser!;
    const movieId = req.query.movie_id ? String(req.query.movie_id) : null;
    const theatreId = admin.role === 'THEATRE_ADMIN' ? admin.assigned_theatre_id : req.query.theatre_id ? String(req.query.theatre_id) : null;
    const showDate = req.query.date ? String(req.query.date) : null;

    const clauses: string[] = [];
    const params: unknown[] = [];
    if (movieId) {
      clauses.push('s.movie_id = ?');
      params.push(movieId);
    }
    if (theatreId) {
      clauses.push('s.theatre_id = ?');
      params.push(theatreId);
    }
    if (showDate) {
      clauses.push('s.show_date = ?');
      params.push(showDate);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT s.*, m.title as movie_title, m.poster_url as movie_poster,
                t.name as theatre_name, t.logo_code as theatre_logo_code,
                sc.name as screen_name, sc.screen_number
         FROM shows s
         JOIN movies m ON m.id = s.movie_id
         JOIN theatres t ON t.id = s.theatre_id
         JOIN screens sc ON sc.id = s.screen_id
         ${where}
         ORDER BY s.show_date ASC, s.start_time ASC`
      )
      .all(...params) as Array<Record<string, unknown>>;

    res.json({ shows: rows.map(hydrateShowWithMetrics) });
  });

  router.post('/shows', requireAdmin(['SUPER_ADMIN', 'THEATRE_ADMIN']), (req: AdminRequest, res) => {
    const admin = req.adminUser!;
    const b = req.body || {};
    const movieId = String(b.movie_id || '').trim();
    const theatreId = String(b.theatre_id || '').trim();
    const screenId = String(b.screen_id || '').trim();
    const showDate = String(b.show_date || '').trim();
    const startTime = String(b.start_time || '').trim();
    const endTime = String(b.end_time || '').trim();

    if (!movieId || !theatreId || !screenId || !showDate || !startTime || !endTime) {
      res.status(400).json({ error: 'movie_id, theatre_id, screen_id, show_date, start_time, and end_time are required.' });
      return;
    }
    if (admin.role === 'THEATRE_ADMIN' && admin.assigned_theatre_id !== theatreId) {
      res.status(403).json({ error: 'Cannot create shows for another theatre.' });
      return;
    }

    const movieExists = db.prepare('SELECT id FROM movies WHERE id = ?').get(movieId);
    if (!movieExists) {
      res.status(404).json({ error: 'Selected movie does not exist. Please refresh and choose a valid movie.' });
      return;
    }
    const theatreExists = db.prepare('SELECT id FROM theatres WHERE id = ?').get(theatreId);
    if (!theatreExists) {
      res.status(404).json({ error: 'Selected theatre does not exist.' });
      return;
    }
    const screenRow = db.prepare('SELECT id, theatre_id FROM screens WHERE id = ?').get(screenId) as
      | { id: string; theatre_id: string }
      | undefined;
    if (!screenRow) {
      res.status(404).json({ error: 'Selected screen does not exist. Add a screen to this theatre first.' });
      return;
    }
    if (screenRow.theatre_id !== theatreId) {
      res.status(400).json({ error: 'Selected screen does not belong to the selected theatre.' });
      return;
    }

    const overlap = checkShowOverlap(screenId, showDate, startTime, endTime);
    if (overlap.overlaps) {
      res.status(409).json({
        error: `Show overlaps with an existing show on this screen (${overlap.conflictingShow?.start_time} – ${overlap.conflictingShow?.end_time}).`,
      });
      return;
    }

    const id = uid('sh');
    db.prepare(
      `INSERT INTO shows (id, movie_id, theatre_id, screen_id, show_date, start_time, end_time, language, format, sound_system, status, booking_open_at, booking_close_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      movieId,
      theatreId,
      screenId,
      showDate,
      startTime,
      endTime,
      b.language || 'Tamil',
      b.format || '2D',
      b.sound_system || 'Dolby Atmos',
      b.status || 'ACTIVE',
      b.booking_open_at || null,
      b.booking_close_at || null
    );
    logAudit(admin, 'CREATE_SHOW', 'show', id, { movie_id: movieId, show_date: showDate, start_time: startTime });
    res.status(201).json({ id, message: 'Show scheduled successfully.' });
  });

  router.put('/shows/:id', requireAdmin(['SUPER_ADMIN', 'THEATRE_ADMIN']), (req: AdminRequest, res) => {
    const admin = req.adminUser!;
    const id = String(req.params.id || '').trim();
    const existing = db.prepare('SELECT * FROM shows WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Show not found.' });
      return;
    }
    if (admin.role === 'THEATRE_ADMIN' && admin.assigned_theatre_id !== String(existing.theatre_id)) {
      res.status(403).json({ error: 'Cannot edit shows belonging to another theatre.' });
      return;
    }

    const b = req.body || {};
    const nextMovie = b.movie_id !== undefined && String(b.movie_id).trim() !== '' ? String(b.movie_id).trim() : String(existing.movie_id);
    const nextTheatre =
      b.theatre_id !== undefined && String(b.theatre_id).trim() !== '' ? String(b.theatre_id).trim() : String(existing.theatre_id);
    const nextScreen =
      b.screen_id !== undefined && String(b.screen_id).trim() !== '' ? String(b.screen_id).trim() : String(existing.screen_id);
    const nextDate = b.show_date ? String(b.show_date).trim() : String(existing.show_date);
    const nextStart = b.start_time ? String(b.start_time).trim() : String(existing.start_time);
    const nextEnd = b.end_time ? String(b.end_time).trim() : String(existing.end_time);

    if (b.screen_id !== undefined && String(b.screen_id).trim() === '') {
      res.status(400).json({ error: 'Please select a valid screen for this theatre before saving.' });
      return;
    }
    if (admin.role === 'THEATRE_ADMIN' && admin.assigned_theatre_id !== nextTheatre) {
      res.status(403).json({ error: 'Cannot reassign a show to another theatre.' });
      return;
    }

    if (!db.prepare('SELECT id FROM movies WHERE id = ?').get(nextMovie)) {
      res.status(404).json({ error: 'Selected movie does not exist.' });
      return;
    }
    if (!db.prepare('SELECT id FROM theatres WHERE id = ?').get(nextTheatre)) {
      res.status(404).json({ error: 'Selected theatre does not exist.' });
      return;
    }
    const screenRow = db.prepare('SELECT id, theatre_id FROM screens WHERE id = ?').get(nextScreen) as
      | { id: string; theatre_id: string }
      | undefined;
    if (!screenRow) {
      res.status(404).json({ error: 'Selected screen does not exist.' });
      return;
    }
    if (screenRow.theatre_id !== nextTheatre) {
      res.status(400).json({ error: 'Selected screen does not belong to the selected theatre.' });
      return;
    }

    if ((b.status || existing.status) !== 'CANCELLED') {
      const overlap = checkShowOverlap(nextScreen, nextDate, nextStart, nextEnd, id);
      if (overlap.overlaps) {
        res.status(409).json({
          error: `Updated timing overlaps with existing show (${overlap.conflictingShow?.start_time} – ${overlap.conflictingShow?.end_time}).`,
        });
        return;
      }
    }

    db.prepare(
      `UPDATE shows SET
        movie_id = ?,
        theatre_id = ?,
        screen_id = ?,
        show_date = ?,
        start_time = ?,
        end_time = ?,
        language = COALESCE(?, language),
        format = COALESCE(?, format),
        sound_system = COALESCE(?, sound_system),
        status = COALESCE(?, status),
        booking_open_at = ?,
        booking_close_at = ?
       WHERE id = ?`
    ).run(
      nextMovie,
      nextTheatre,
      nextScreen,
      nextDate,
      nextStart,
      nextEnd,
      b.language ? String(b.language).trim() : null,
      b.format ? String(b.format).trim() : null,
      b.sound_system ? String(b.sound_system).trim() : null,
      b.status ? String(b.status).trim() : null,
      b.booking_open_at !== undefined ? b.booking_open_at : existing.booking_open_at,
      b.booking_close_at !== undefined ? b.booking_close_at : existing.booking_close_at,
      id
    );
    logAudit(admin, 'UPDATE_SHOW', 'show', id, { status: b.status || existing.status, show_date: nextDate });
    res.json({ message: 'Show updated.' });
  });

  router.delete('/shows/:id', requireAdmin(['SUPER_ADMIN', 'THEATRE_ADMIN']), (req: AdminRequest, res) => {
    const admin = req.adminUser!;
    const id = String(req.params.id || '').trim();
    const show = db.prepare('SELECT id, theatre_id, show_date, start_time FROM shows WHERE id = ?').get(id) as
      | { id: string; theatre_id: string; show_date: string; start_time: string }
      | undefined;
    if (!show) {
      res.status(404).json({ error: 'Show not found.' });
      return;
    }
    if (admin.role === 'THEATRE_ADMIN' && admin.assigned_theatre_id !== show.theatre_id) {
      res.status(403).json({ error: 'Cannot delete a show belonging to another theatre.' });
      return;
    }

    const bookedSeatsCount = (db.prepare('SELECT COUNT(*) as c FROM booking_seats WHERE show_id = ?').get(id) as { c: number }).c;
    const bookingsCount = (db.prepare('SELECT COUNT(*) as c FROM bookings WHERE show_id = ?').get(id) as { c: number }).c;
    const bulkBookingsCount = (
      db.prepare('SELECT COUNT(*) as c FROM bulk_bookings WHERE show_id = ?').get(id) as { c: number }
    ).c;

    if (bookedSeatsCount > 0 || bookingsCount > 0 || bulkBookingsCount > 0) {
      const detail =
        bookedSeatsCount > 0
          ? `${bookedSeatsCount} confirmed seat(s) across ${bookingsCount} booking(s)`
          : `${bookingsCount} historical/cancelled booking(s)${bulkBookingsCount > 0 ? ` and ${bulkBookingsCount} bulk booking(s)` : ''}`;
      res.status(409).json({
        error: `Cannot delete show (${show.show_date} ${show.start_time}) because it has ${detail}. Edit the show and set its status to CANCELLED or INACTIVE instead to preserve ticket & payment history.`,
      });
      return;
    }

    const deleteTx = db.transaction(() => {
      db.prepare(`DELETE FROM booking_windows WHERE scope_type = 'SHOW' AND scope_id = ?`).run(id);
      db.prepare('DELETE FROM movie_pricing WHERE show_id = ?').run(id);
      db.prepare('DELETE FROM shows WHERE id = ?').run(id);
    });
    deleteTx();

    logAudit(admin, 'DELETE_SHOW', 'show', id, { show_date: show.show_date, start_time: show.start_time });
    res.json({ message: 'Show deleted.' });
  });

  // 8. BOOKING SCHEDULE & ADVANCE BOOKING CONTROL
  router.get('/booking-windows', requireAdmin(['SUPER_ADMIN', 'THEATRE_ADMIN', 'BOOKING_MANAGER']), (_req, res) => {
    res.json({ windows: formatBookingWindowsWithLabels() });
  });

  router.post('/booking-windows', requireAdmin(['SUPER_ADMIN', 'THEATRE_ADMIN']), (req: AdminRequest, res) => {
    const b = req.body || {};
    if (!b.scope_type || !b.scope_id || !b.booking_open_at || !b.booking_close_at) {
      res.status(400).json({ error: 'scope_type, scope_id, booking_open_at, and booking_close_at are required.' });
      return;
    }
    if (b.scope_type === 'MOVIE' && !db.prepare('SELECT id FROM movies WHERE id = ?').get(b.scope_id)) {
      res.status(404).json({ error: 'Selected movie was not found.' });
      return;
    }
    if (b.scope_type === 'SHOW' && !db.prepare('SELECT id FROM shows WHERE id = ?').get(b.scope_id)) {
      res.status(404).json({ error: 'Selected show was not found.' });
      return;
    }

    const existing = db
      .prepare('SELECT id FROM booking_windows WHERE scope_type = ? AND scope_id = ?')
      .get(b.scope_type, b.scope_id) as { id: string } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE booking_windows SET
          booking_open_at = ?,
          booking_close_at = ?,
          advance_enabled = ?,
          max_advance_days = ?,
          advance_start_date = ?,
          advance_end_date = ?,
          status = ?,
          announcement_text = ?,
          updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        b.booking_open_at,
        b.booking_close_at,
        b.advance_enabled ? 1 : 0,
        Number(b.max_advance_days || 7),
        b.advance_start_date || null,
        b.advance_end_date || null,
        b.status || 'OPEN',
        b.announcement_text || null,
        existing.id
      );
      logAudit(req.adminUser!, 'UPDATE_BOOKING_WINDOW', 'booking_window', existing.id, {
        scope: `${b.scope_type}:${b.scope_id}`,
        status: b.status,
      });
      res.json({ id: existing.id, message: 'Booking schedule updated.' });
    } else {
      const id = uid('win');
      db.prepare(
        `INSERT INTO booking_windows (id, scope_type, scope_id, booking_open_at, booking_close_at, advance_enabled, max_advance_days, advance_start_date, advance_end_date, status, announcement_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        b.scope_type,
        b.scope_id,
        b.booking_open_at,
        b.booking_close_at,
        b.advance_enabled ? 1 : 0,
        Number(b.max_advance_days || 7),
        b.advance_start_date || null,
        b.advance_end_date || null,
        b.status || 'OPEN',
        b.announcement_text || null
      );
      logAudit(req.adminUser!, 'CREATE_BOOKING_WINDOW', 'booking_window', id, {
        scope: `${b.scope_type}:${b.scope_id}`,
        status: b.status,
      });
      res.status(201).json({ id, message: 'Booking schedule created.' });
    }
  });

  router.delete('/booking-windows/:id', requireAdmin(['SUPER_ADMIN']), (req: AdminRequest, res) => {
    const id = req.params.id;
    const row = db.prepare('SELECT scope_type FROM booking_windows WHERE id = ?').get(id) as { scope_type: string } | undefined;
    if (row?.scope_type === 'GLOBAL') {
      res.status(400).json({ error: 'Cannot delete Global default booking window.' });
      return;
    }
    db.prepare('DELETE FROM booking_windows WHERE id = ?').run(id);
    logAudit(req.adminUser!, 'DELETE_BOOKING_WINDOW', 'booking_window', id);
    res.json({ message: 'Booking schedule removed.' });
  });

  // 9. LIVE SEAT AVAILABILITY & SHOW-SPECIFIC BLOCKING
  router.post('/shows/:showId/block-seats', requireAdmin(['SUPER_ADMIN', 'THEATRE_ADMIN', 'BOOKING_MANAGER']), (req: AdminRequest, res) => {
    const admin = req.adminUser!;
    const showId = String(req.params.showId || '').trim();
    const showRow = db.prepare('SELECT id, theatre_id FROM shows WHERE id = ?').get(showId) as
      | { id: string; theatre_id: string }
      | undefined;
    if (!showRow) {
      res.status(404).json({ error: 'Selected show was not found.' });
      return;
    }
    if (admin.role === 'THEATRE_ADMIN' && admin.assigned_theatre_id !== showRow.theatre_id) {
      res.status(403).json({ error: 'Cannot modify seat blocks for another theatre.' });
      return;
    }

    const { seat_ids, action, reason } = req.body || {};
    if (!Array.isArray(seat_ids) || seat_ids.length === 0) {
      res.status(400).json({ error: 'seat_ids array is required.' });
      return;
    }

    const tx = db.transaction(() => {
      if (action === 'UNBLOCK') {
        const del = db.prepare('DELETE FROM show_seat_blocks WHERE show_id = ? AND seat_id = ?');
        for (const sid of seat_ids) {
          del.run(showId, String(sid));
        }
      } else {
        const checkBooked = db.prepare('SELECT 1 FROM booking_seats WHERE show_id = ? AND seat_id = ?');
        const ins = db.prepare(
          `INSERT OR IGNORE INTO show_seat_blocks (id, show_id, seat_id, reason, blocked_by)
           VALUES (?, ?, ?, ?, ?)`
        );
        for (const sid of seat_ids) {
          if (checkBooked.get(showId, String(sid))) {
            throw new Error(`Seat ${sid} is already booked and cannot be blocked.`);
          }
          ins.run(uid('blk'), showId, String(sid), String(reason || 'Admin Reserved'), admin.id);
        }
      }
    });

    try {
      tx();
      logAudit(admin, action === 'UNBLOCK' ? 'UNBLOCK_SEATS' : 'BLOCK_SEATS', 'show', showId, {
        count: seat_ids.length,
        seats: seat_ids,
      });
      res.json({ message: `${seat_ids.length} seat(s) ${action === 'UNBLOCK' ? 'unblocked' : 'blocked'} for this show.` });
    } catch (err) {
      res.status(409).json({ error: (err as Error).message });
    }
  });

  router.post('/shows/:showId/release-locks', requireAdmin(['SUPER_ADMIN', 'THEATRE_ADMIN', 'BOOKING_MANAGER']), (req: AdminRequest, res) => {
    const admin = req.adminUser!;
    const showId = String(req.params.showId || '').trim();
    const showRow = db.prepare('SELECT id, theatre_id FROM shows WHERE id = ?').get(showId) as
      | { id: string; theatre_id: string }
      | undefined;
    if (!showRow) {
      res.status(404).json({ error: 'Selected show was not found.' });
      return;
    }
    if (admin.role === 'THEATRE_ADMIN' && admin.assigned_theatre_id !== showRow.theatre_id) {
      res.status(403).json({ error: 'Cannot release locks for another theatre.' });
      return;
    }
    const all = Boolean(req.body?.force_all);
    const changes = all
      ? db.prepare('DELETE FROM seat_locks WHERE show_id = ?').run(showId).changes
      : purgeExpiredLocks();
    logAudit(admin, 'RELEASE_SEAT_LOCKS', 'show', showId, { released: changes, force_all: all });
    res.json({ released: changes, message: `Released ${changes} temporary lock(s).` });
  });

  // 10. BOOKING MANAGEMENT
  router.get('/bookings', requireAdmin(), (req: AdminRequest, res) => {
    const admin = req.adminUser!;
    const q = String(req.query.q || '').trim().toLowerCase();
    const movieId = String(req.query.movie_id || '');
    const theatreId = admin.role === 'THEATRE_ADMIN' ? admin.assigned_theatre_id || '' : String(req.query.theatre_id || '');
    const paymentStatus = String(req.query.payment_status || '');
    const bookingStatus = String(req.query.booking_status || '');
    const dateFrom = String(req.query.from || '');
    const dateTo = String(req.query.to || '');

    const clauses: string[] = [];
    const params: unknown[] = [];
    if (q) {
      clauses.push(`(LOWER(b.booking_code) LIKE ? OR LOWER(b.customer_name) LIKE ? OR LOWER(b.customer_mobile) LIKE ?)`);
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (movieId) {
      clauses.push('b.movie_id = ?');
      params.push(movieId);
    }
    if (theatreId) {
      clauses.push('b.theatre_id = ?');
      params.push(theatreId);
    }
    if (paymentStatus) {
      clauses.push('b.payment_status = ?');
      params.push(paymentStatus);
    }
    if (bookingStatus) {
      clauses.push('b.booking_status = ?');
      params.push(bookingStatus);
    }
    if (dateFrom) {
      clauses.push('b.show_date >= ?');
      params.push(dateFrom);
    }
    if (dateTo) {
      clauses.push('b.show_date <= ?');
      params.push(dateTo);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db
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
         ${where}
         ORDER BY b.created_at DESC`
      )
      .all(...params) as Array<Record<string, unknown>>;

    res.json({ bookings: rows.map(hydrateBookingRow) });
  });

  router.post('/bookings/:id/cancel', requireAdmin(['SUPER_ADMIN', 'BOOKING_MANAGER']), (req: AdminRequest, res) => {
    const id = req.params.id;
    const reason = String(req.body?.reason || 'Cancelled by administrator per policy');
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!booking) {
      res.status(404).json({ error: 'Booking not found.' });
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
         cancelled_at = datetime('now'), cancellation_reason = ? WHERE id = ?`
      ).run(reason, id);
      db.prepare('DELETE FROM booking_seats WHERE booking_id = ?').run(id);
      db.prepare(
        `UPDATE payments SET status = 'PARTIALLY_REFUNDED', refund_amount = ?, refund_status = 'PROCESSED'
         WHERE booking_id = ?`
      ).run(refundAmount, id);
      db.prepare(
        `INSERT INTO notifications (id, type, title, message, target_user_id, channel)
         VALUES (?, 'BOOKING_CANCELLATION', ?, ?, ?, 'IN_APP')`
      ).run(
        uid('ntf'),
        `Booking ${booking.booking_code} Cancelled`,
        `Your booking has been cancelled (${reason}). Refund of ₹${refundAmount} has been initiated.`,
        booking.user_id || null
      );
    });
    tx();

    logAudit(req.adminUser!, 'CANCEL_BOOKING', 'booking', id, { reason, refund_amount: refundAmount });
    res.json({ message: `Booking cancelled and ₹${refundAmount} refund initiated.` });
  });

  // 11. CUSTOMER MANAGEMENT
  router.get('/customers', requireAdmin(['SUPER_ADMIN', 'BOOKING_MANAGER']), (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const rows = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.mobile, u.city, u.status, u.created_at,
                COUNT(CASE WHEN b.booking_status = 'CONFIRMED' THEN 1 END) as booking_count,
                COALESCE(SUM(CASE WHEN b.booking_status = 'CONFIRMED' THEN b.seat_count ELSE 0 END), 0) as total_tickets,
                ROUND(COALESCE(SUM(CASE WHEN b.booking_status = 'CONFIRMED' THEN b.total_amount ELSE 0 END), 0), 2) as total_spent
         FROM users u
         LEFT JOIN bookings b ON b.user_id = u.id
         WHERE u.role = 'CUSTOMER'
           ${q ? `AND (LOWER(u.name) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(u.mobile) LIKE ?)` : ''}
         GROUP BY u.id
         ORDER BY total_spent DESC`
      )
      .all(...(q ? [`%${q}%`, `%${q}%`, `%${q}%`] : []));
    res.json({ customers: rows });
  });

  router.put('/customers/:id/status', requireAdmin(['SUPER_ADMIN', 'BOOKING_MANAGER']), (req: AdminRequest, res) => {
    const status = req.body?.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
    db.prepare(`UPDATE users SET status = ? WHERE id = ? AND role = 'CUSTOMER'`).run(status, req.params.id);
    logAudit(req.adminUser!, 'UPDATE_CUSTOMER_STATUS', 'user', req.params.id, { status });
    res.json({ message: `Customer account set to ${status}.` });
  });

  // 12. PAYMENT MANAGEMENT
  router.get('/payments', requireAdmin(['SUPER_ADMIN', 'ACCOUNTANT', 'BOOKING_MANAGER']), (req, res) => {
    const status = String(req.query.status || '');
    const rows = db
      .prepare(
        `SELECT p.*, b.booking_code, b.customer_name, b.customer_mobile,
                m.title as movie_title, t.name as theatre_name
         FROM payments p
         JOIN bookings b ON b.id = p.booking_id
         JOIN movies m ON m.id = b.movie_id
         JOIN theatres t ON t.id = b.theatre_id
         ${status ? 'WHERE p.status = ?' : ''}
         ORDER BY p.created_at DESC`
      )
      .all(...(status ? [status] : []));
    res.json({ payments: rows });
  });

  // 13. OFFERS & PROMOTIONS
  router.get('/offers', requireAdmin(['SUPER_ADMIN', 'THEATRE_ADMIN']), (_req, res) => {
    const rows = db.prepare('SELECT * FROM offers ORDER BY display_order ASC, start_date DESC').all() as Array<
      Record<string, unknown>
    >;
    res.json({
      offers: rows.map((r) => ({ ...r, is_active: Boolean(r.is_active) })),
    });
  });

  router.post('/offers', requireAdmin(['SUPER_ADMIN']), (req: AdminRequest, res) => {
    const b = req.body || {};
    if (!b.title || !b.coupon_code) {
      res.status(400).json({ error: 'Title and coupon_code are required.' });
      return;
    }
    const id = uid('off');
    try {
      db.prepare(
        `INSERT INTO offers (id, title, subtitle, description, banner_url, cta_label, coupon_code, discount_type, discount_value, min_booking_amount, max_discount, start_date, expiry_date, is_active, display_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        String(b.title),
        String(b.subtitle || 'TICKETNOW SPECIAL'),
        String(b.description || ''),
        String(b.banner_url || '/src/assets/images/promo_banner_atmos_1794932274876.jpg'),
        String(b.cta_label || `Use ${String(b.coupon_code).toUpperCase()}`),
        String(b.coupon_code).toUpperCase().trim(),
        b.discount_type === 'PERCENT' ? 'PERCENT' : 'FLAT',
        Number(b.discount_value || 50),
        Number(b.min_booking_amount || 200),
        Number(b.max_discount || 150),
        String(b.start_date || formatLocalDate(new Date())),
        String(b.expiry_date || '2026-12-31'),
        b.is_active !== false ? 1 : 0,
        Number(b.display_order || 1)
      );
      logAudit(req.adminUser!, 'CREATE_OFFER', 'offer', id, { code: b.coupon_code });
      res.status(201).json({ id, message: 'Offer created.' });
    } catch {
      res.status(409).json({ error: 'Coupon code already exists.' });
    }
  });

  router.put('/offers/:id', requireAdmin(['SUPER_ADMIN']), (req: AdminRequest, res) => {
    const b = req.body || {};
    db.prepare(
      `UPDATE offers SET
        title = COALESCE(?, title),
        subtitle = COALESCE(?, subtitle),
        description = COALESCE(?, description),
        banner_url = COALESCE(?, banner_url),
        cta_label = COALESCE(?, cta_label),
        discount_type = COALESCE(?, discount_type),
        discount_value = COALESCE(?, discount_value),
        min_booking_amount = COALESCE(?, min_booking_amount),
        max_discount = COALESCE(?, max_discount),
        start_date = COALESCE(?, start_date),
        expiry_date = COALESCE(?, expiry_date),
        is_active = COALESCE(?, is_active)
       WHERE id = ?`
    ).run(
      b.title ?? null,
      b.subtitle ?? null,
      b.description ?? null,
      b.banner_url ?? null,
      b.cta_label ?? null,
      b.discount_type ?? null,
      b.discount_value !== undefined ? Number(b.discount_value) : null,
      b.min_booking_amount !== undefined ? Number(b.min_booking_amount) : null,
      b.max_discount !== undefined ? Number(b.max_discount) : null,
      b.start_date ?? null,
      b.expiry_date ?? null,
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : null,
      req.params.id
    );
    logAudit(req.adminUser!, 'UPDATE_OFFER', 'offer', req.params.id);
    res.json({ message: 'Offer updated.' });
  });

  router.delete('/offers/:id', requireAdmin(['SUPER_ADMIN']), (req: AdminRequest, res) => {
    db.prepare('DELETE FROM offers WHERE id = ?').run(req.params.id);
    logAudit(req.adminUser!, 'DELETE_OFFER', 'offer', req.params.id);
    res.json({ message: 'Offer deleted.' });
  });

  // 14. NOTIFICATIONS
  router.get('/notifications', requireAdmin(['SUPER_ADMIN', 'BOOKING_MANAGER']), (_req, res) => {
    const rows = db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100').all() as Array<
      Record<string, unknown>
    >;
    res.json({ notifications: rows.map((r) => ({ ...r, is_read: Boolean(r.is_read) })) });
  });

  router.post('/notifications', requireAdmin(['SUPER_ADMIN', 'BOOKING_MANAGER']), (req: AdminRequest, res) => {
    const b = req.body || {};
    if (!b.title || !b.message) {
      res.status(400).json({ error: 'Title and message are required.' });
      return;
    }
    const id = uid('ntf');
    db.prepare(
      `INSERT INTO notifications (id, type, title, message, target_user_id, channel)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, b.type || 'MOVIE_ANNOUNCEMENT', b.title, b.message, b.target_user_id || null, b.channel || 'IN_APP');
    logAudit(req.adminUser!, 'SEND_NOTIFICATION', 'notification', id, { type: b.type, title: b.title });
    res.status(201).json({ id, message: 'Notification published to customers.' });
  });

  // 15. REPORTS & ANALYTICS (JSON + CSV + EXCEL EXPORT)
  function buildReportRows(type: string, fromDate: string, toDate: string): Array<Record<string, unknown>> {
    const dateClause = fromDate && toDate ? `AND substr(b.created_at, 1, 10) BETWEEN ? AND ?` : '';
    const dateParams = fromDate && toDate ? [fromDate, toDate] : [];

    switch (type) {
      case 'daily':
      case 'weekly':
      case 'monthly':
        return db
          .prepare(
            `SELECT substr(b.created_at, 1, 10) as Date,
                    COUNT(*) as Bookings,
                    SUM(b.seat_count) as Tickets_Sold,
                    ROUND(SUM(b.subtotal), 2) as Ticket_Revenue_INR,
                    ROUND(SUM(b.convenience_fee), 2) as Convenience_Fee_INR,
                    ROUND(SUM(b.tax_amount), 2) as GST_INR,
                    ROUND(SUM(b.total_amount), 2) as Gross_Collection_INR
             FROM bookings b
             WHERE b.booking_status = 'CONFIRMED' ${dateClause}
             GROUP BY substr(b.created_at, 1, 10)
             ORDER BY Date DESC`
          )
          .all(...dateParams) as Array<Record<string, unknown>>;

      case 'movie':
        return db
          .prepare(
            `SELECT m.title as Movie, m.language as Language, m.certification as Certification,
                    COUNT(b.id) as Bookings,
                    COALESCE(SUM(b.seat_count), 0) as Tickets_Sold,
                    ROUND(COALESCE(SUM(b.total_amount), 0), 2) as Gross_Collection_INR
             FROM movies m
             LEFT JOIN bookings b ON b.movie_id = m.id AND b.booking_status = 'CONFIRMED' ${dateClause}
             GROUP BY m.id
             ORDER BY Gross_Collection_INR DESC`
          )
          .all(...dateParams) as Array<Record<string, unknown>>;

      case 'theatre':
        return db
          .prepare(
            `SELECT t.name as Theatre, t.city as City,
                    COUNT(b.id) as Bookings,
                    COALESCE(SUM(b.seat_count), 0) as Tickets_Sold,
                    ROUND(COALESCE(SUM(b.total_amount), 0), 2) as Gross_Collection_INR
             FROM theatres t
             LEFT JOIN bookings b ON b.theatre_id = t.id AND b.booking_status = 'CONFIRMED' ${dateClause}
             GROUP BY t.id
             ORDER BY Gross_Collection_INR DESC`
          )
          .all(...dateParams) as Array<Record<string, unknown>>;

      case 'screen':
        return db
          .prepare(
            `SELECT t.name as Theatre, sc.name as Screen, sc.capacity as Capacity,
                    COUNT(b.id) as Bookings,
                    COALESCE(SUM(b.seat_count), 0) as Tickets_Sold,
                    ROUND(COALESCE(SUM(b.total_amount), 0), 2) as Gross_Collection_INR
             FROM screens sc
             JOIN theatres t ON t.id = sc.theatre_id
             LEFT JOIN bookings b ON b.screen_id = sc.id AND b.booking_status = 'CONFIRMED' ${dateClause}
             GROUP BY sc.id
             ORDER BY Gross_Collection_INR DESC`
          )
          .all(...dateParams) as Array<Record<string, unknown>>;

      case 'show':
        return db
          .prepare(
            `SELECT s.show_date as Show_Date, s.start_time as Start_Time, m.title as Movie,
                    t.name as Theatre, sc.name as Screen,
                    COUNT(b.id) as Bookings,
                    COALESCE(SUM(b.seat_count), 0) as Tickets_Sold,
                    ROUND(COALESCE(SUM(b.total_amount), 0), 2) as Gross_Collection_INR
             FROM shows s
             JOIN movies m ON m.id = s.movie_id
             JOIN theatres t ON t.id = s.theatre_id
             JOIN screens sc ON sc.id = s.screen_id
             LEFT JOIN bookings b ON b.show_id = s.id AND b.booking_status = 'CONFIRMED'
             GROUP BY s.id
             ORDER BY Gross_Collection_INR DESC LIMIT 100`
          )
          .all() as Array<Record<string, unknown>>;

      case 'category': {
        const bookings = db
          .prepare(`SELECT seats_json FROM bookings b WHERE b.booking_status = 'CONFIRMED' ${dateClause}`)
          .all(...dateParams) as Array<{ seats_json: string }>;
        const map = new Map<string, { Category: string; Tickets_Sold: number; Ticket_Revenue_INR: number }>();
        for (const row of bookings) {
          const seats = JSON.parse(row.seats_json) as Array<{ category_name: string; unit_price: number }>;
          for (const s of seats) {
            const cur = map.get(s.category_name) ?? { Category: s.category_name, Tickets_Sold: 0, Ticket_Revenue_INR: 0 };
            cur.Tickets_Sold += 1;
            cur.Ticket_Revenue_INR = Math.round((cur.Ticket_Revenue_INR + s.unit_price) * 100) / 100;
            map.set(s.category_name, cur);
          }
        }
        return Array.from(map.values()).sort((a, b) => b.Ticket_Revenue_INR - a.Ticket_Revenue_INR);
      }

      case 'cancellation':
        return db
          .prepare(
            `SELECT b.booking_code as Booking_ID, b.customer_name as Customer, m.title as Movie,
                    t.name as Theatre, b.show_date as Show_Date, b.seat_count as Seats,
                    b.total_amount as Original_Amount_INR, b.cancellation_reason as Reason, b.cancelled_at as Cancelled_At
             FROM bookings b
             JOIN movies m ON m.id = b.movie_id
             JOIN theatres t ON t.id = b.theatre_id
             WHERE b.booking_status = 'CANCELLED'
             ORDER BY b.cancelled_at DESC`
          )
          .all() as Array<Record<string, unknown>>;

      case 'payment':
        return db
          .prepare(
            `SELECT p.transaction_id as Transaction_ID, b.booking_code as Booking_ID, b.customer_name as Customer,
                    p.gateway as Gateway, p.method as Method, p.amount as Amount_INR, p.status as Payment_Status,
                    p.refund_amount as Refund_INR, p.refund_status as Refund_Status, p.created_at as Paid_At
             FROM payments p JOIN bookings b ON b.id = p.booking_id
             ORDER BY p.created_at DESC`
          )
          .all() as Array<Record<string, unknown>>;

      default:
        return db
          .prepare(
            `SELECT b.booking_code as Booking_ID, b.customer_name as Customer, b.customer_mobile as Mobile,
                    m.title as Movie, t.name as Theatre, sc.name as Screen,
                    b.show_date as Show_Date, b.show_time as Show_Time, b.seat_count as Seats,
                    b.total_amount as Total_INR, b.payment_status as Payment_Status, b.booking_status as Status, b.created_at as Booked_At
             FROM bookings b
             JOIN movies m ON m.id = b.movie_id
             JOIN theatres t ON t.id = b.theatre_id
             JOIN screens sc ON sc.id = b.screen_id
             WHERE 1=1 ${dateClause}
             ORDER BY b.created_at DESC`
          )
          .all(...dateParams) as Array<Record<string, unknown>>;
    }
  }

  router.get('/reports', requireAdmin(['SUPER_ADMIN', 'ACCOUNTANT', 'THEATRE_ADMIN']), (req, res) => {
    const type = String(req.query.type || 'daily');
    const fromDate = String(req.query.from || '');
    const toDate = String(req.query.to || '');
    const rows = buildReportRows(type, fromDate, toDate);
    res.json({ type, rows });
  });

  router.get('/reports/export', requireAdmin(['SUPER_ADMIN', 'ACCOUNTANT', 'THEATRE_ADMIN']), (req, res) => {
    const type = String(req.query.type || 'daily');
    const format = String(req.query.format || 'csv').toLowerCase();
    const fromDate = String(req.query.from || '');
    const toDate = String(req.query.to || '');
    const rows = buildReportRows(type, fromDate, toDate);

    const safeRows = rows.length > 0 ? rows : [{ Message: 'No records found for selected criteria' }];
    const ws = XLSX.utils.json_to_sheet(safeRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `TICKETNOW_${type}`);

    if (format === 'xlsx') {
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="ticketnow-${type}-report.xlsx"`);
      res.send(buf);
    } else {
      const csv = XLSX.utils.sheet_to_csv(ws);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="ticketnow-${type}-report.csv"`);
      res.send(csv);
    }
  });

  // 16. ADMIN USERS & AUDIT LOGS
  router.get('/users', requireAdmin(['SUPER_ADMIN']), (_req, res) => {
    const admins = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.mobile, u.role, u.assigned_theatre_id, u.city, u.status, u.created_at,
                t.name as assigned_theatre_name
         FROM users u
         LEFT JOIN theatres t ON t.id = u.assigned_theatre_id
         WHERE u.role != 'CUSTOMER'
         ORDER BY u.created_at ASC`
      )
      .all();
    const auditLogs = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 80').all() as Array<
      Record<string, unknown>
    >;
    res.json({
      admins,
      audit_logs: auditLogs.map((l) => ({
        ...l,
        details: JSON.parse(String(l.details_json || '{}')),
      })),
    });
  });

  router.post('/users', requireAdmin(['SUPER_ADMIN']), (req: AdminRequest, res) => {
    const b = req.body || {};
    if (!b.name || !b.email || !b.password || !b.role) {
      res.status(400).json({ error: 'name, email, password, and role are required.' });
      return;
    }
    const assignedTheatreId =
      b.role === 'THEATRE_ADMIN' && b.assigned_theatre_id ? String(b.assigned_theatre_id).trim() : null;
    if (assignedTheatreId && !db.prepare('SELECT id FROM theatres WHERE id = ?').get(assignedTheatreId)) {
      res.status(404).json({ error: 'Assigned theatre was not found.' });
      return;
    }
    const id = uid('usr');
    const hash = bcrypt.hashSync(String(b.password), 8);
    try {
      db.prepare(
        `INSERT INTO users (id, name, email, mobile, password_hash, role, assigned_theatre_id, city, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`
      ).run(
        id,
        String(b.name).trim(),
        String(b.email).trim().toLowerCase(),
        String(b.mobile || '+91 90000 00000'),
        hash,
        String(b.role),
        assignedTheatreId,
        String(b.city || 'Tirunelveli')
      );
      logAudit(req.adminUser!, 'CREATE_ADMIN_USER', 'user', id, { email: b.email, role: b.role });
      res.status(201).json({ id, message: 'Admin user created.' });
    } catch {
      res.status(409).json({ error: 'An account with this email already exists.' });
    }
  });

  router.put('/users/:id/status', requireAdmin(['SUPER_ADMIN']), (req: AdminRequest, res) => {
    if (req.params.id === req.adminUser!.id) {
      res.status(400).json({ error: 'You cannot deactivate your own active Super Admin account.' });
      return;
    }
    const status = req.body?.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
    db.prepare(`UPDATE users SET status = ? WHERE id = ?`).run(status, req.params.id);
    logAudit(req.adminUser!, 'UPDATE_ADMIN_STATUS', 'user', req.params.id, { status });
    res.json({ message: `Admin status updated to ${status}.` });
  });

  // 17. GLOBAL SETTINGS
  router.get('/settings', requireAdmin(['SUPER_ADMIN', 'THEATRE_ADMIN', 'ACCOUNTANT']), (_req, res) => {
    res.json({ settings: getSettings() });
  });

  router.put('/settings', requireAdmin(['SUPER_ADMIN']), (req: AdminRequest, res) => {
    const b = req.body || {};
    db.prepare(
      `UPDATE settings SET
        app_name = COALESCE(?, app_name),
        app_logo_url = COALESCE(?, app_logo_url),
        contact_email = COALESCE(?, contact_email),
        contact_phone = COALESCE(?, contact_phone),
        support_hours = COALESCE(?, support_hours),
        currency = COALESCE(?, currency),
        convenience_fee_per_seat = COALESCE(?, convenience_fee_per_seat),
        tax_rate_percent = COALESCE(?, tax_rate_percent),
        cancellation_policy = COALESCE(?, cancellation_policy),
        terms_text = COALESCE(?, terms_text),
        privacy_text = COALESCE(?, privacy_text),
        lock_duration_seconds = COALESCE(?, lock_duration_seconds)
       WHERE id = 1`
    ).run(
      b.app_name ?? null,
      b.app_logo_url ?? null,
      b.contact_email ?? null,
      b.contact_phone ?? null,
      b.support_hours ?? null,
      b.currency ?? null,
      b.convenience_fee_per_seat !== undefined ? Number(b.convenience_fee_per_seat) : null,
      b.tax_rate_percent !== undefined ? Number(b.tax_rate_percent) : null,
      b.cancellation_policy ?? null,
      b.terms_text ?? null,
      b.privacy_text ?? null,
      b.lock_duration_seconds !== undefined ? Number(b.lock_duration_seconds) : null
    );
    logAudit(req.adminUser!, 'UPDATE_SETTINGS', 'settings', '1', { convenience_fee: b.convenience_fee_per_seat, tax_rate: b.tax_rate_percent });
    res.json({ settings: getSettings(), message: 'Global settings saved.' });
  });

  // 18. BULK BOOKING SYSTEM & BULK BOOKING HISTORY
  function hydrateBulkBooking(row: Record<string, unknown>): BulkBookingRecord {
    const tickets = db
      .prepare(
        `SELECT t.*, b.booking_code
         FROM bulk_booking_tickets t
         LEFT JOIN bookings b ON b.id = t.booking_id
         WHERE t.bulk_booking_id = ?
         ORDER BY t.row_label ASC, t.seat_number ASC`
      )
      .all(row.id) as BulkBookingTicket[];

    const bookingCodes = Array.from(
      new Set(tickets.map((t) => t.booking_code).filter((c): c is string => Boolean(c)))
    );

    return {
      id: String(row.id),
      bulk_code: String(row.bulk_code),
      mode: row.mode === 'MULTIPLE_CUSTOMERS' ? 'MULTIPLE_CUSTOMERS' : 'SINGLE_CUSTOMER',
      reference_code: String(row.reference_code || ''),
      theatre_id: String(row.theatre_id),
      theatre_name: String(row.theatre_name || ''),
      theatre_address: row.theatre_address ? String(row.theatre_address) : '',
      screen_id: String(row.screen_id),
      screen_name: String(row.screen_name || ''),
      screen_number: Number(row.screen_number || 1),
      movie_id: String(row.movie_id),
      movie_title: String(row.movie_title || ''),
      movie_language: row.movie_language ? String(row.movie_language) : '',
      movie_certification: row.movie_certification ? String(row.movie_certification) : '',
      show_id: String(row.show_id),
      show_date: String(row.show_date),
      show_time: String(row.show_time),
      primary_customer_name: String(row.primary_customer_name),
      primary_customer_mobile: String(row.primary_customer_mobile),
      primary_customer_email: String(row.primary_customer_email || ''),
      customer_count: Number(row.customer_count || 1),
      total_tickets: Number(row.total_tickets || tickets.length),
      subtotal: Number(row.subtotal),
      convenience_fee: Number(row.convenience_fee),
      discount_amount: Number(row.discount_amount),
      tax_amount: Number(row.tax_amount),
      total_amount: Number(row.total_amount),
      payment_method: String(row.payment_method || 'ADMIN_DIRECT'),
      payment_status: row.payment_status as BulkBookingRecord['payment_status'],
      booking_status: row.booking_status as BulkBookingRecord['booking_status'],
      created_by_admin_id: String(row.created_by_admin_id),
      created_by_admin_name: String(row.created_by_admin_name),
      created_at: String(row.created_at),
      cancelled_at: row.cancelled_at ? String(row.cancelled_at) : null,
      cancellation_reason: row.cancellation_reason ? String(row.cancellation_reason) : null,
      booking_codes: bookingCodes,
      tickets,
    };
  }

  function queryBulkBookings(
    admin: AuthUser,
    filters: { q?: string; date?: string; movie_id?: string }
  ): BulkBookingRecord[] {
    const conds: string[] = [];
    const params: unknown[] = [];

    if (admin.role === 'THEATRE_ADMIN' && admin.assigned_theatre_id) {
      conds.push('bb.theatre_id = ?');
      params.push(admin.assigned_theatre_id);
    }
    if (filters.date) {
      conds.push('bb.show_date = ?');
      params.push(filters.date);
    }
    if (filters.movie_id) {
      conds.push('bb.movie_id = ?');
      params.push(filters.movie_id);
    }
    if (filters.q) {
      const like = `%${filters.q.toLowerCase()}%`;
      conds.push(
        `(LOWER(bb.bulk_code) LIKE ? OR LOWER(bb.primary_customer_name) LIKE ? OR LOWER(bb.primary_customer_mobile) LIKE ? OR LOWER(bb.reference_code) LIKE ? OR LOWER(m.title) LIKE ? OR EXISTS (SELECT 1 FROM bulk_booking_tickets t WHERE t.bulk_booking_id = bb.id AND (LOWER(t.customer_name) LIKE ? OR LOWER(t.ticket_number) LIKE ?)))`
      );
      params.push(like, like, like, like, like, like, like);
    }

    const whereClause = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT bb.*,
                m.title as movie_title, m.language as movie_language, m.certification as movie_certification,
                t.name as theatre_name, t.address as theatre_address,
                sc.name as screen_name, sc.screen_number
         FROM bulk_bookings bb
         JOIN movies m ON m.id = bb.movie_id
         JOIN theatres t ON t.id = bb.theatre_id
         JOIN screens sc ON sc.id = bb.screen_id
         ${whereClause}
         ORDER BY bb.created_at DESC`
      )
      .all(...params) as Array<Record<string, unknown>>;

    return rows.map((r) => hydrateBulkBooking(r));
  }

  router.get('/bulk-bookings', requireAdmin(), (req: AdminRequest, res) => {
    const records = queryBulkBookings(req.adminUser!, {
      q: req.query.q ? String(req.query.q).trim() : '',
      date: req.query.date ? String(req.query.date).trim() : '',
      movie_id: req.query.movie_id ? String(req.query.movie_id).trim() : '',
    });
    res.json({ bulk_bookings: records });
  });

  router.get('/bulk-bookings/export', requireAdmin(), (req: AdminRequest, res) => {
    const format = String(req.query.format || 'csv').toLowerCase();
    const records = queryBulkBookings(req.adminUser!, {
      q: req.query.q ? String(req.query.q).trim() : '',
      date: req.query.date ? String(req.query.date).trim() : '',
      movie_id: req.query.movie_id ? String(req.query.movie_id).trim() : '',
    });

    const rows = records.map((r) => ({
      Bulk_Booking_ID: r.bulk_code,
      Mode: r.mode,
      Reference: r.reference_code || '-',
      Primary_Customer: r.primary_customer_name,
      Mobile: r.primary_customer_mobile,
      Email: r.primary_customer_email || '-',
      Customers_Count: r.customer_count,
      Theatre: r.theatre_name,
      Screen: r.screen_name,
      Movie: r.movie_title,
      Show_Date: r.show_date,
      Show_Time: r.show_time,
      Tickets_Count: r.total_tickets,
      Seat_Numbers: r.tickets.map((t) => t.seat_id).join(', '),
      Subtotal_INR: r.subtotal,
      Convenience_Fee_INR: r.convenience_fee,
      Discount_INR: r.discount_amount,
      GST_INR: r.tax_amount,
      Total_Amount_INR: r.total_amount,
      Payment_Method: r.payment_method,
      Payment_Status: r.payment_status,
      Booking_Status: r.booking_status,
      Booked_By_Admin: r.created_by_admin_name,
      Created_At: r.created_at,
    }));

    const safeRows = rows.length > 0 ? rows : [{ Message: 'No bulk bookings found for selected filters' }];
    const ws = XLSX.utils.json_to_sheet(safeRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'TICKETNOW_Bulk_Bookings');

    if (format === 'xlsx') {
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="ticketnow-bulk-bookings.xlsx"');
      res.send(buf);
    } else {
      const csv = XLSX.utils.sheet_to_csv(ws);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="ticketnow-bulk-bookings.csv"');
      res.send(csv);
    }
  });

  router.get('/bulk-bookings/:id', requireAdmin(), (req: AdminRequest, res) => {
    const row = db
      .prepare(
        `SELECT bb.*,
                m.title as movie_title, m.language as movie_language, m.certification as movie_certification,
                t.name as theatre_name, t.address as theatre_address,
                sc.name as screen_name, sc.screen_number
         FROM bulk_bookings bb
         JOIN movies m ON m.id = bb.movie_id
         JOIN theatres t ON t.id = bb.theatre_id
         JOIN screens sc ON sc.id = bb.screen_id
         WHERE bb.id = ?`
      )
      .get(req.params.id) as Record<string, unknown> | undefined;

    if (!row) {
      res.status(404).json({ error: 'Bulk booking not found.' });
      return;
    }
    res.json({ bulk_booking: hydrateBulkBooking(row) });
  });

  router.post(
    '/bulk-bookings',
    requireAdmin(['SUPER_ADMIN', 'THEATRE_ADMIN', 'BOOKING_MANAGER']),
    (req: AdminRequest, res) => {
      const admin = req.adminUser!;
      const body = req.body || {};

      const showId = String(body.show_id || '').trim();
      const mode: 'SINGLE_CUSTOMER' | 'MULTIPLE_CUSTOMERS' =
        body.mode === 'MULTIPLE_CUSTOMERS' ? 'MULTIPLE_CUSTOMERS' : 'SINGLE_CUSTOMER';
      const referenceCode = String(body.reference_code || '').trim();
      const idempotencyKey = body.idempotency_key ? String(body.idempotency_key).trim() : null;
      const paymentMethod = String(body.payment_method || 'ADMIN_DIRECT').trim();
      const rawCustomers = Array.isArray(body.customers) ? body.customers : [];

      if (!showId) {
        res.status(400).json({ error: 'Please select a valid show before confirming bulk booking.' });
        return;
      }
      if (rawCustomers.length === 0) {
        res.status(400).json({ error: 'At least one customer record with assigned seats is required.' });
        return;
      }

      // Duplicate transaction guard via idempotency_key
      if (idempotencyKey) {
        const existingBulk = db
          .prepare('SELECT id, bulk_code FROM bulk_bookings WHERE idempotency_key = ?')
          .get(idempotencyKey) as { id: string; bulk_code: string } | undefined;
        if (existingBulk) {
          res.status(409).json({
            error: `Duplicate booking submission prevented. This transaction was already recorded as ${existingBulk.bulk_code}.`,
            duplicate_bulk_code: existingBulk.bulk_code,
          });
          return;
        }
      }

      const showRow = db
        .prepare(
          `SELECT s.*, m.title as movie_title, t.name as theatre_name, sc.name as screen_name, sc.screen_number, sc.layout_json
           FROM shows s
           JOIN movies m ON m.id = s.movie_id
           JOIN theatres t ON t.id = s.theatre_id
           JOIN screens sc ON sc.id = s.screen_id
           WHERE s.id = ?`
        )
        .get(showId) as Record<string, unknown> | undefined;

      if (!showRow || showRow.status !== 'ACTIVE') {
        res.status(404).json({ error: 'Selected show is not active or could not be found.' });
        return;
      }

      if (admin.role === 'THEATRE_ADMIN' && admin.assigned_theatre_id !== String(showRow.theatre_id)) {
        res.status(403).json({ error: 'You can only create bulk bookings for your assigned theatre.' });
        return;
      }

      // Normalize & validate customer records
      const normalizedCustomers: Array<{ name: string; mobile: string; email: string; seat_ids: string[] }> = [];
      const allRequestedSeats: string[] = [];
      const seenInRequest = new Set<string>();
      const duplicateInRequest: string[] = [];

      for (let i = 0; i < rawCustomers.length; i++) {
        const c = rawCustomers[i] as Record<string, unknown>;
        const name = String(c.name || '').trim();
        const mobile = String(c.mobile || '').trim();
        const email = String(c.email || '').trim();
        const seatIds = Array.isArray(c.seat_ids)
          ? c.seat_ids.map((s) => String(s).trim()).filter(Boolean)
          : [];

        if (!name) {
          res.status(400).json({ error: `Customer #${i + 1}: Name is required.` });
          return;
        }
        if (mobile.replace(/\D/g, '').length < 10) {
          res.status(400).json({ error: `Customer "${name}": A valid 10-digit mobile number is required.` });
          return;
        }
        if (seatIds.length === 0) {
          res.status(400).json({ error: `Customer "${name}" has no seats assigned.` });
          return;
        }

        for (const sid of seatIds) {
          if (seenInRequest.has(sid)) {
            duplicateInRequest.push(sid);
          } else {
            seenInRequest.add(sid);
            allRequestedSeats.push(sid);
          }
        }
        normalizedCustomers.push({ name, mobile, email, seat_ids: seatIds });
      }

      if (duplicateInRequest.length > 0) {
        res.status(400).json({
          error: `Duplicate seat assignments detected: ${duplicateInRequest.join(', ')}. Each seat can only be assigned once.`,
        });
        return;
      }

      const layout: ScreenLayoutV2 = JSON.parse(String(showRow.layout_json));
      const seatLookup = new Map(layout.seats.map((s) => [s.id, s]));
      const catLookup = new Map(layout.categories.map((c) => [c.id, c]));
      const layoutBlockedSet = new Set<string>(Array.isArray(layout.blocked_seats) ? layout.blocked_seats : []);
      const { resolveSeatPrice } = resolveSeatPrices(
        layout,
        String(showRow.movie_id),
        String(showRow.theatre_id),
        String(showRow.screen_id),
        showId
      );

      const settings = getSettings();
      const convFeePerSeat =
        body.convenience_fee_per_seat !== undefined && body.convenience_fee_per_seat !== null
          ? Math.max(0, Number(body.convenience_fee_per_seat))
          : settings.convenience_fee_per_seat;
      const requestedDiscount = Math.max(0, Number(body.discount_amount || 0));
      const applyTax = body.apply_tax !== false;

      class BulkUnavailableError extends Error {
        unavailable: Array<{ seat_id: string; reason: string }>;
        constructor(unavailable: Array<{ seat_id: string; reason: string }>) {
          const list = unavailable.map((u) => `${u.seat_id} (${u.reason})`).join(', ');
          super(`Bulk booking aborted — no partial seats were booked. Unavailable seats: ${list}`);
          this.unavailable = unavailable;
        }
      }

      const runAtomicBulkTx = db.transaction(() => {
        purgeExpiredLocks();

        const unavailable: Array<{ seat_id: string; reason: string }> = [];
        for (const seatId of allRequestedSeats) {
          const seat = seatLookup.get(seatId);
          if (!seat) {
            unavailable.push({ seat_id: seatId, reason: 'Does not exist in layout' });
            continue;
          }
          if (db.prepare('SELECT 1 FROM booking_seats WHERE show_id = ? AND seat_id = ?').get(showId, seatId)) {
            unavailable.push({ seat_id: seatId, reason: 'Already occupied' });
            continue;
          }
          if (
            layoutBlockedSet.has(seatId) ||
            seat.status === 'BLOCKED' ||
            seat.status === 'DISABLED' ||
            db.prepare('SELECT 1 FROM show_seat_blocks WHERE show_id = ? AND seat_id = ?').get(showId, seatId)
          ) {
            unavailable.push({ seat_id: seatId, reason: 'Blocked by management' });
            continue;
          }
          const activeLock = db
            .prepare('SELECT session_key FROM seat_locks WHERE show_id = ? AND seat_id = ?')
            .get(showId, seatId) as { session_key: string } | undefined;
          if (activeLock) {
            unavailable.push({ seat_id: seatId, reason: 'Temporarily locked by another customer' });
            continue;
          }
        }

        if (unavailable.length > 0) {
          throw new BulkUnavailableError(unavailable);
        }

        const dateTag = formatLocalDate(new Date()).replace(/-/g, '').slice(2);
        const bulkId = uid('blk');
        const bulkCode = `TN-BLK-${dateTag}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        // Compute total financial breakdown across all requested seats
        let grandSubtotal = 0;
        const customerGroupCalculations = normalizedCustomers.map((cust) => {
          const snapshots: BookingSeatSnapshot[] = cust.seat_ids.map((seatId) => {
            const seat = seatLookup.get(seatId)!;
            const { price, source } = resolveSeatPrice(seat);
            grandSubtotal += price;
            return {
              seat_id: seat.id,
              row: seat.row,
              number: seat.number,
              category_id: seat.category_id,
              category_name: catLookup.get(seat.category_id)?.name || 'STANDARD',
              unit_price: price,
              price_source: source,
            };
          });
          const subtotal = Math.round(snapshots.reduce((s, x) => s + x.unit_price, 0) * 100) / 100;
          return { cust, snapshots, subtotal };
        });

        grandSubtotal = Math.round(grandSubtotal * 100) / 100;
        const grandDiscount = Math.min(grandSubtotal, Math.round(requestedDiscount * 100) / 100);
        const grandConvenienceFee = Math.round(allRequestedSeats.length * convFeePerSeat * 100) / 100;
        const grandTax = applyTax
          ? Math.round(grandConvenienceFee * (settings.tax_rate_percent / 100) * 100) / 100
          : 0;
        const grandTotal =
          Math.round((grandSubtotal - grandDiscount + grandConvenienceFee + grandTax) * 100) / 100;

        const primary = normalizedCustomers[0];

        db.prepare(
          `INSERT INTO bulk_bookings (
            id, bulk_code, idempotency_key, mode, reference_code,
            theatre_id, screen_id, movie_id, show_id, show_date, show_time,
            primary_customer_name, primary_customer_mobile, primary_customer_email,
            customer_count, total_tickets, subtotal, convenience_fee, discount_amount,
            tax_amount, total_amount, payment_method, payment_status, booking_status,
            created_by_admin_id, created_by_admin_name
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUCCESS', 'CONFIRMED', ?, ?)`
        ).run(
          bulkId,
          bulkCode,
          idempotencyKey,
          mode,
          referenceCode,
          String(showRow.theatre_id),
          String(showRow.screen_id),
          String(showRow.movie_id),
          showId,
          String(showRow.show_date),
          String(showRow.start_time),
          primary.name,
          primary.mobile,
          primary.email,
          normalizedCustomers.length,
          allRequestedSeats.length,
          grandSubtotal,
          grandConvenienceFee,
          grandDiscount,
          grandTax,
          grandTotal,
          paymentMethod,
          admin.id,
          admin.name
        );

        let ticketSeq = 1;
        let allocatedDiscount = 0;

        customerGroupCalculations.forEach(({ cust, snapshots, subtotal }, groupIdx) => {
          const isLast = groupIdx === customerGroupCalculations.length - 1;
          const groupDiscount = isLast
            ? Math.round((grandDiscount - allocatedDiscount) * 100) / 100
            : grandSubtotal > 0
            ? Math.round(((subtotal / grandSubtotal) * grandDiscount) * 100) / 100
            : 0;
          allocatedDiscount = Math.round((allocatedDiscount + groupDiscount) * 100) / 100;

          const groupConvFee = Math.round(snapshots.length * convFeePerSeat * 100) / 100;
          const groupTax = applyTax
            ? Math.round(groupConvFee * (settings.tax_rate_percent / 100) * 100) / 100
            : 0;
          const groupTotal = Math.round((subtotal - groupDiscount + groupConvFee + groupTax) * 100) / 100;

          const bookingId = uid('bkg');
          const bookingCode = `TN-${dateTag}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
          const bookingQr = JSON.stringify({
            app: 'TICKETNOW',
            bulk_code: bulkCode,
            code: bookingCode,
            movie: showRow.movie_title,
            theatre: showRow.theatre_name,
            screen: showRow.screen_name,
            date: showRow.show_date,
            time: showRow.start_time,
            customer: cust.name,
            seats: snapshots.map((s) => s.seat_id),
            total: groupTotal,
          });

          db.prepare(
            `INSERT INTO bookings (
              id, booking_code, user_id, customer_name, customer_mobile, customer_email,
              movie_id, theatre_id, screen_id, show_id, show_date, show_time,
              seats_json, seat_count, subtotal, discount_amount, offer_code,
              convenience_fee, tax_amount, total_amount, payment_status, booking_status, qr_payload
            ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUCCESS', 'CONFIRMED', ?)`
          ).run(
            bookingId,
            bookingCode,
            cust.name,
            cust.mobile,
            cust.email,
            String(showRow.movie_id),
            String(showRow.theatre_id),
            String(showRow.screen_id),
            showId,
            String(showRow.show_date),
            String(showRow.start_time),
            JSON.stringify(snapshots),
            snapshots.length,
            subtotal,
            groupDiscount,
            referenceCode || bulkCode,
            groupConvFee,
            groupTax,
            groupTotal,
            bookingQr
          );

          const txnId = `TXN-BLK-${Date.now().toString(36).toUpperCase()}-${Math.random()
            .toString(36)
            .slice(2, 6)
            .toUpperCase()}-${groupIdx + 1}`;
          db.prepare(
            `INSERT INTO payments (id, transaction_id, booking_id, user_id, gateway, method, amount, status, verified_at)
             VALUES (?, ?, ?, NULL, 'TICKETNOW Bulk Counter', ?, ?, 'SUCCESS', datetime('now'))`
          ).run(uid('pay'), txnId, bookingId, paymentMethod, groupTotal);

          for (const snap of snapshots) {
            // Database-level UNIQUE(show_id, seat_id) enforces zero double booking
            db.prepare('INSERT INTO booking_seats (id, show_id, seat_id, booking_id) VALUES (?, ?, ?, ?)').run(
              uid('bs'),
              showId,
              snap.seat_id,
              bookingId
            );

            const ticketNumber = `TKT-${dateTag}-${String(ticketSeq).padStart(3, '0')}-${snap.seat_id}-${Math.random()
              .toString(36)
              .slice(2, 5)
              .toUpperCase()}`;
            ticketSeq++;

            const ticketQr = JSON.stringify({
              app: 'TICKETNOW',
              type: 'SINGLE_TICKET',
              ticket_number: ticketNumber,
              bulk_code: bulkCode,
              booking_code: bookingCode,
              movie: showRow.movie_title,
              theatre: showRow.theatre_name,
              screen: showRow.screen_name,
              date: showRow.show_date,
              time: showRow.start_time,
              seat: snap.seat_id,
              category: snap.category_name,
              price: snap.unit_price,
              guest: cust.name,
              mobile: cust.mobile,
            });

            db.prepare(
              `INSERT INTO bulk_booking_tickets (
                id, bulk_booking_id, booking_id, ticket_number, show_id,
                seat_id, row_label, seat_number, category_id, category_name, unit_price,
                customer_name, customer_mobile, customer_email, qr_payload, ticket_status
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED')`
            ).run(
              uid('tkt'),
              bulkId,
              bookingId,
              ticketNumber,
              showId,
              snap.seat_id,
              snap.row,
              snap.number,
              snap.category_id,
              snap.category_name,
              snap.unit_price,
              cust.name,
              cust.mobile,
              cust.email,
              ticketQr
            );
          }
        });

        db.prepare(
          `INSERT INTO notifications (id, type, title, message, target_user_id, channel)
           VALUES (?, 'BOOKING_CONFIRMATION', ?, ?, NULL, 'IN_APP')`
        ).run(
          uid('ntf'),
          `Bulk Booking ${bulkCode} Confirmed`,
          `${allRequestedSeats.length} tickets issued for ${showRow.movie_title} at ${showRow.theatre_name} (${showRow.show_date} ${showRow.start_time}).`
        );

        return bulkId;
      });

      try {
        const bulkId = runAtomicBulkTx();
        const createdRow = db
          .prepare(
            `SELECT bb.*,
                    m.title as movie_title, m.language as movie_language, m.certification as movie_certification,
                    t.name as theatre_name, t.address as theatre_address,
                    sc.name as screen_name, sc.screen_number
             FROM bulk_bookings bb
             JOIN movies m ON m.id = bb.movie_id
             JOIN theatres t ON t.id = bb.theatre_id
             JOIN screens sc ON sc.id = bb.screen_id
             WHERE bb.id = ?`
          )
          .get(bulkId) as Record<string, unknown>;

        const hydrated = hydrateBulkBooking(createdRow);
        logAudit(admin, 'CREATE_BULK_BOOKING', 'bulk_booking', bulkId, {
          bulk_code: hydrated.bulk_code,
          mode,
          seats: hydrated.total_tickets,
          total_amount: hydrated.total_amount,
        });

        res.status(201).json({
          message: `Bulk booking ${hydrated.bulk_code} confirmed (${hydrated.total_tickets} tickets generated).`,
          bulk_booking: hydrated,
        });
      } catch (err) {
        if (err instanceof BulkUnavailableError) {
          res.status(409).json({
            error: err.message,
            unavailable_seats: err.unavailable,
          });
          return;
        }
        const rawMsg = (err as Error).message || '';
        const friendlyMsg = rawMsg.includes('FOREIGN KEY')
          ? 'The selected show, screen, theatre, or movie is no longer available. Please refresh and try again.'
          : rawMsg.includes('UNIQUE')
          ? 'One or more selected seats were just booked in another transaction. Please refresh the seat map.'
          : rawMsg || 'Unable to complete bulk booking due to seat conflict.';
        res.status(409).json({
          error: friendlyMsg,
        });
      }
    }
  );

  router.post(
    '/bulk-bookings/:id/cancel',
    requireAdmin(['SUPER_ADMIN', 'THEATRE_ADMIN', 'BOOKING_MANAGER']),
    (req: AdminRequest, res) => {
      const admin = req.adminUser!;
      const bulkId = req.params.id;
      const reason = String(req.body?.reason || '').trim();
      const authConfirm = String(req.body?.authorization_code || '').trim();

      if (!reason) {
        res.status(400).json({ error: 'A cancellation reason is required for authorized cancellation.' });
        return;
      }
      if (authConfirm.toUpperCase() !== 'CANCEL') {
        res.status(400).json({ error: 'Please type CANCEL to authorize bulk booking cancellation.' });
        return;
      }

      const bulk = db.prepare('SELECT * FROM bulk_bookings WHERE id = ?').get(bulkId) as
        | Record<string, unknown>
        | undefined;
      if (!bulk) {
        res.status(404).json({ error: 'Bulk booking record not found.' });
        return;
      }
      if (admin.role === 'THEATRE_ADMIN' && admin.assigned_theatre_id !== String(bulk.theatre_id)) {
        res.status(403).json({ error: 'You cannot cancel bulk bookings belonging to another theatre.' });
        return;
      }
      if (bulk.booking_status === 'CANCELLED') {
        res.status(400).json({ error: 'This bulk booking is already cancelled.' });
        return;
      }

      const linkedBookingIds = (
        db
          .prepare('SELECT DISTINCT booking_id FROM bulk_booking_tickets WHERE bulk_booking_id = ?')
          .all(bulkId) as Array<{ booking_id: string }>
      ).map((r) => r.booking_id);

      const cancelTx = db.transaction(() => {
        db.prepare(
          `UPDATE bulk_bookings
           SET booking_status = 'CANCELLED', payment_status = 'REFUNDED',
               cancelled_at = datetime('now'), cancellation_reason = ?
           WHERE id = ?`
        ).run(`${reason} (Authorized by ${admin.name})`, bulkId);

        db.prepare(`UPDATE bulk_booking_tickets SET ticket_status = 'CANCELLED' WHERE bulk_booking_id = ?`).run(bulkId);

        for (const bid of linkedBookingIds) {
          db.prepare(
            `UPDATE bookings
             SET booking_status = 'CANCELLED', payment_status = 'REFUNDED',
                 cancelled_at = datetime('now'), cancellation_reason = ?
             WHERE id = ?`
          ).run(`Bulk booking ${bulk.bulk_code} cancelled: ${reason}`, bid);

          db.prepare('DELETE FROM booking_seats WHERE booking_id = ?').run(bid);

          db.prepare(
            `UPDATE payments
             SET status = 'REFUNDED', refund_amount = amount, refund_status = 'PROCESSED'
             WHERE booking_id = ?`
          ).run(bid);
        }
      });

      cancelTx();
      logAudit(admin, 'CANCEL_BULK_BOOKING', 'bulk_booking', bulkId, {
        bulk_code: bulk.bulk_code,
        reason,
        seats_released: bulk.total_tickets,
      });

      res.json({
        message: `Bulk booking ${bulk.bulk_code} cancelled. All ${bulk.total_tickets} seats have been released immediately.`,
      });
    }
  );

  return router;
}

