import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const defaultDbPath = path.resolve(process.cwd(), 'data', 'ticketnow.db');
const dbPath = process.env.DB_PATH ? path.resolve(process.cwd(), process.env.DB_PATH) : defaultDbPath;
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      app_name TEXT NOT NULL DEFAULT 'TICKETNOW',
      app_logo_url TEXT NOT NULL DEFAULT '',
      contact_email TEXT NOT NULL DEFAULT 'support@ticketnow.in',
      contact_phone TEXT NOT NULL DEFAULT '+91 4633 224 890',
      support_hours TEXT NOT NULL DEFAULT '08:00 AM – 11:30 PM IST',
      currency TEXT NOT NULL DEFAULT 'INR',
      convenience_fee_per_seat REAL NOT NULL DEFAULT 15,
      tax_rate_percent REAL NOT NULL DEFAULT 18,
      cancellation_policy TEXT NOT NULL DEFAULT 'Tickets for cancellable theatres can be cancelled up to 2 hours prior to showtime for a 75% refund of the ticket value. Convenience fees are non-refundable.',
      terms_text TEXT NOT NULL DEFAULT 'By booking through TICKETNOW you agree to arrive 15 minutes before showtime, carry a valid QR pass, and adhere to theatre admission and certification policies.',
      privacy_text TEXT NOT NULL DEFAULT 'TICKETNOW collects only the minimum contact and booking details required to issue cinema tickets, process verified payments, and deliver show alerts.',
      lock_duration_seconds INTEGER NOT NULL DEFAULT 300
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      mobile TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'CUSTOMER',
      assigned_theatre_id TEXT,
      city TEXT NOT NULL DEFAULT 'Tirunelveli',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS theatres (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      logo_code TEXT NOT NULL,
      logo_url TEXT,
      image_url TEXT,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      district TEXT NOT NULL,
      maps_location TEXT NOT NULL DEFAULT '',
      distance_km REAL NOT NULL DEFAULT 2.5,
      contact_number TEXT NOT NULL DEFAULT '',
      facilities_json TEXT NOT NULL DEFAULT '[]',
      cancellation_policy TEXT NOT NULL DEFAULT 'Non-cancellable',
      is_cancellable INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS screens (
      id TEXT PRIMARY KEY,
      theatre_id TEXT NOT NULL,
      screen_number INTEGER NOT NULL,
      name TEXT NOT NULL,
      screen_type TEXT NOT NULL DEFAULT '2D / 4K',
      sound_system TEXT NOT NULL DEFAULT 'Dolby Atmos',
      projection_type TEXT NOT NULL DEFAULT '4K RGB Laser',
      capacity INTEGER NOT NULL DEFAULT 120,
      image_url TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      layout_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (theatre_id) REFERENCES theatres(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS movies (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      language TEXT NOT NULL,
      genre TEXT NOT NULL,
      certification TEXT NOT NULL,
      duration_mins INTEGER NOT NULL,
      release_date TEXT NOT NULL,
      poster_url TEXT NOT NULL,
      banner_url TEXT,
      trailer_url TEXT,
      description TEXT NOT NULL,
      cast_json TEXT NOT NULL DEFAULT '[]',
      crew_json TEXT NOT NULL DEFAULT '[]',
      rating REAL,
      is_top_selling INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'NOW_SHOWING',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS booking_windows (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      booking_open_at TEXT NOT NULL,
      booking_close_at TEXT NOT NULL,
      advance_enabled INTEGER NOT NULL DEFAULT 1,
      max_advance_days INTEGER NOT NULL DEFAULT 7,
      advance_start_date TEXT,
      advance_end_date TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN',
      announcement_text TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(scope_type, scope_id)
    );

    CREATE TABLE IF NOT EXISTS movie_pricing (
      id TEXT PRIMARY KEY,
      movie_id TEXT NOT NULL,
      theatre_id TEXT,
      screen_id TEXT,
      show_id TEXT,
      category_id TEXT NOT NULL,
      price REAL NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shows (
      id TEXT PRIMARY KEY,
      movie_id TEXT NOT NULL,
      theatre_id TEXT NOT NULL,
      screen_id TEXT NOT NULL,
      show_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      language TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT '2D',
      sound_system TEXT NOT NULL DEFAULT 'Dolby Atmos',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      booking_open_at TEXT,
      booking_close_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE RESTRICT,
      FOREIGN KEY (theatre_id) REFERENCES theatres(id) ON DELETE RESTRICT,
      FOREIGN KEY (screen_id) REFERENCES screens(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS show_seat_blocks (
      id TEXT PRIMARY KEY,
      show_id TEXT NOT NULL,
      seat_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT 'Admin Reserved',
      blocked_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(show_id, seat_id),
      FOREIGN KEY (show_id) REFERENCES shows(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS seat_locks (
      id TEXT PRIMARY KEY,
      show_id TEXT NOT NULL,
      seat_id TEXT NOT NULL,
      session_key TEXT NOT NULL,
      user_id TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(show_id, seat_id),
      FOREIGN KEY (show_id) REFERENCES shows(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      booking_code TEXT NOT NULL UNIQUE,
      user_id TEXT,
      customer_name TEXT NOT NULL,
      customer_mobile TEXT NOT NULL,
      customer_email TEXT NOT NULL DEFAULT '',
      movie_id TEXT NOT NULL,
      theatre_id TEXT NOT NULL,
      screen_id TEXT NOT NULL,
      show_id TEXT NOT NULL,
      show_date TEXT NOT NULL,
      show_time TEXT NOT NULL,
      seats_json TEXT NOT NULL,
      seat_count INTEGER NOT NULL,
      subtotal REAL NOT NULL,
      discount_amount REAL NOT NULL DEFAULT 0,
      offer_code TEXT,
      convenience_fee REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'PENDING',
      booking_status TEXT NOT NULL DEFAULT 'PENDING',
      qr_payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      cancelled_at TEXT,
      cancellation_reason TEXT,
      FOREIGN KEY (movie_id) REFERENCES movies(id),
      FOREIGN KEY (theatre_id) REFERENCES theatres(id),
      FOREIGN KEY (screen_id) REFERENCES screens(id),
      FOREIGN KEY (show_id) REFERENCES shows(id)
    );

    CREATE TABLE IF NOT EXISTS booking_seats (
      id TEXT PRIMARY KEY,
      show_id TEXT NOT NULL,
      seat_id TEXT NOT NULL,
      booking_id TEXT NOT NULL,
      UNIQUE(show_id, seat_id),
      FOREIGN KEY (show_id) REFERENCES shows(id) ON DELETE CASCADE,
      FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL UNIQUE,
      booking_id TEXT NOT NULL,
      user_id TEXT,
      gateway TEXT NOT NULL,
      method TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL,
      refund_amount REAL NOT NULL DEFAULT 0,
      refund_status TEXT NOT NULL DEFAULT 'NONE',
      verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS offers (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL,
      description TEXT NOT NULL,
      banner_url TEXT NOT NULL,
      cta_label TEXT NOT NULL DEFAULT 'Book Now',
      coupon_code TEXT NOT NULL UNIQUE,
      discount_type TEXT NOT NULL DEFAULT 'FLAT',
      discount_value REAL NOT NULL,
      min_booking_amount REAL NOT NULL DEFAULT 250,
      max_discount REAL NOT NULL DEFAULT 150,
      start_date TEXT NOT NULL,
      expiry_date TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      display_order INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      target_user_id TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      channel TEXT NOT NULL DEFAULT 'IN_APP',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL,
      admin_name TEXT NOT NULL,
      admin_role TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS favourites (
      user_id TEXT NOT NULL,
      theatre_id TEXT NOT NULL,
      PRIMARY KEY (user_id, theatre_id)
    );

    CREATE TABLE IF NOT EXISTS bulk_bookings (
      id TEXT PRIMARY KEY,
      bulk_code TEXT NOT NULL UNIQUE,
      idempotency_key TEXT UNIQUE,
      mode TEXT NOT NULL,
      reference_code TEXT NOT NULL DEFAULT '',
      theatre_id TEXT NOT NULL,
      screen_id TEXT NOT NULL,
      movie_id TEXT NOT NULL,
      show_id TEXT NOT NULL,
      show_date TEXT NOT NULL,
      show_time TEXT NOT NULL,
      primary_customer_name TEXT NOT NULL,
      primary_customer_mobile TEXT NOT NULL,
      primary_customer_email TEXT NOT NULL DEFAULT '',
      customer_count INTEGER NOT NULL DEFAULT 1,
      total_tickets INTEGER NOT NULL,
      subtotal REAL NOT NULL,
      convenience_fee REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'ADMIN_DIRECT',
      payment_status TEXT NOT NULL DEFAULT 'SUCCESS',
      booking_status TEXT NOT NULL DEFAULT 'CONFIRMED',
      created_by_admin_id TEXT NOT NULL,
      created_by_admin_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      cancelled_at TEXT,
      cancellation_reason TEXT,
      FOREIGN KEY (theatre_id) REFERENCES theatres(id),
      FOREIGN KEY (screen_id) REFERENCES screens(id),
      FOREIGN KEY (movie_id) REFERENCES movies(id),
      FOREIGN KEY (show_id) REFERENCES shows(id)
    );

    CREATE TABLE IF NOT EXISTS bulk_booking_tickets (
      id TEXT PRIMARY KEY,
      bulk_booking_id TEXT NOT NULL,
      booking_id TEXT NOT NULL,
      ticket_number TEXT NOT NULL UNIQUE,
      show_id TEXT NOT NULL,
      seat_id TEXT NOT NULL,
      row_label TEXT NOT NULL,
      seat_number INTEGER NOT NULL,
      category_id TEXT NOT NULL,
      category_name TEXT NOT NULL,
      unit_price REAL NOT NULL,
      customer_name TEXT NOT NULL,
      customer_mobile TEXT NOT NULL,
      customer_email TEXT NOT NULL DEFAULT '',
      qr_payload TEXT NOT NULL,
      ticket_status TEXT NOT NULL DEFAULT 'CONFIRMED',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (bulk_booking_id) REFERENCES bulk_bookings(id) ON DELETE CASCADE,
      FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
      FOREIGN KEY (show_id) REFERENCES shows(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_shows_movie_date ON shows(movie_id, show_date);
    CREATE INDEX IF NOT EXISTS idx_shows_theatre_date ON shows(theatre_id, show_date);
    CREATE INDEX IF NOT EXISTS idx_bookings_show ON bookings(show_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
    CREATE INDEX IF NOT EXISTS idx_seat_locks_expires ON seat_locks(expires_at);
    CREATE INDEX IF NOT EXISTS idx_bulk_bookings_show ON bulk_bookings(show_id);
    CREATE INDEX IF NOT EXISTS idx_bulk_bookings_date ON bulk_bookings(show_date);
    CREATE INDEX IF NOT EXISTS idx_bulk_tickets_bulk ON bulk_booking_tickets(bulk_booking_id);
  `);

  // Ensure the default global booking window doesn't silently expire or clip newly scheduled future shows
  const globalWin = db
    .prepare(
      `SELECT id, booking_close_at, max_advance_days, advance_start_date, advance_end_date
       FROM booking_windows
       WHERE id = 'win_global' AND scope_type = 'GLOBAL' AND scope_id = 'ALL'`
    )
    .get() as
    | {
        id: string;
        booking_close_at: string;
        max_advance_days: number;
        advance_start_date: string | null;
        advance_end_date: string | null;
      }
    | undefined;

  if (globalWin && globalWin.max_advance_days === 7 && globalWin.advance_end_date !== null) {
    db.prepare(
      `UPDATE booking_windows
       SET booking_close_at = '2099-12-31T23:59:00',
           max_advance_days = 60,
           advance_start_date = NULL,
           advance_end_date = NULL,
           updated_at = datetime('now')
       WHERE id = 'win_global'`
    ).run();
  }
}

