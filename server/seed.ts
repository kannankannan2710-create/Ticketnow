import bcrypt from 'bcryptjs';
import { db } from './db.ts';

function formatDateOffset(baseDate: Date, offsetDays: number): string {
  const d = new Date(baseDate.getTime());
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function seedDatabaseIfEmpty(): void {
  // Always ensure settings row exists
  db.prepare(`INSERT OR IGNORE INTO settings (id) VALUES (1)`).run();

  const existingUsers = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
  if (existingUsers.c > 0) {
    return;
  }

  const now = new Date();

  const hashSuper = bcrypt.hashSync('Admin@123', 8);
  const hashTheatre = bcrypt.hashSync('Theatre@123', 8);
  const hashBooking = bcrypt.hashSync('Booking@123', 8);
  const hashAccount = bcrypt.hashSync('Account@123', 8);
  const hashCustomer = bcrypt.hashSync('Ticket@123', 8);

  const tx = db.transaction(() => {
    // 1. Users (Admin Roles + Base Customer Accounts — no demo theatres/movies attached)
    const insertUser = db.prepare(`
      INSERT INTO users (id, name, email, mobile, password_hash, role, assigned_theatre_id, city, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
    `);
    insertUser.run('usr_super_admin', 'Kannan Sundaram', 'admin@ticketnow.in', '+91 98421 10001', hashSuper, 'SUPER_ADMIN', null, 'Tirunelveli');
    insertUser.run('usr_theatre_admin', 'Muthuram Krishnan', 'ark.admin@ticketnow.in', '+91 98421 10002', hashTheatre, 'THEATRE_ADMIN', null, 'Tirunelveli');
    insertUser.run('usr_booking_mgr', 'Priya Selvam', 'bookings@ticketnow.in', '+91 98421 10003', hashBooking, 'BOOKING_MANAGER', null, 'Tirunelveli');
    insertUser.run('usr_accountant', 'Suresh Natarajan', 'accounts@ticketnow.in', '+91 98421 10004', hashAccount, 'ACCOUNTANT', null, 'Tirunelveli');
    insertUser.run('usr_cust_1', 'Arjun Karthik', 'arjun@gmail.com', '+91 94432 88120', hashCustomer, 'CUSTOMER', null, 'Tirunelveli');
    insertUser.run('usr_cust_2', 'Divya Lakshmi', 'divya.l@gmail.com', '+91 97890 44215', hashCustomer, 'CUSTOMER', null, 'Tirunelveli');
    insertUser.run('usr_cust_3', 'Vigneshwaran R', 'vignesh.r@gmail.com', '+91 96001 55390', hashCustomer, 'CUSTOMER', null, 'Madurai');

    // 2. Global Default Booking Window (open-ended so future admin-scheduled shows are never silently clipped)
    db.prepare(`
      INSERT OR IGNORE INTO booking_windows (id, scope_type, scope_id, booking_open_at, booking_close_at, advance_enabled, max_advance_days, advance_start_date, advance_end_date, status, announcement_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'win_global',
      'GLOBAL',
      'ALL',
      '2024-01-01T00:00:00',
      '2099-12-31T23:59:00',
      1,
      60,
      null,
      null,
      'OPEN',
      'Advance bookings open for shows this week'
    );

    // 3. Platform Promotional Offers
    const insertOffer = db.prepare(`
      INSERT OR IGNORE INTO offers (id, title, subtitle, description, banner_url, cta_label, coupon_code, discount_type, discount_value, min_booking_amount, max_discount, start_date, expiry_date, is_active, display_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);
    insertOffer.run(
      'off_atmos_150',
      'Flat ₹100 Off on Dolby Atmos',
      'TICKETNOW PREMIERE PASS',
      'Experience 4K RGB Laser & Dolby Atmos shows in Tirunelveli with instant savings on 2+ tickets.',
      '/src/assets/images/promo_banner_atmos_1794932274876.jpg',
      'Use Code ATMOS100',
      'ATMOS100',
      'FLAT',
      100,
      300,
      100,
      formatDateOffset(now, -5),
      formatDateOffset(now, 365),
      1
    );
    insertOffer.run(
      'off_district_club',
      '20% Off Weekend Cinema Club',
      'DISTRICT DINING & MOVIES',
      'Save up to ₹150 on weekend tickets + gourmet lobby combos across Tirunelveli partner multiplexes.',
      '/src/assets/images/promo_banner_club_1794932276860.jpg',
      'Apply TICKET20',
      'TICKET20',
      'PERCENT',
      20,
      200,
      150,
      formatDateOffset(now, -5),
      formatDateOffset(now, 365),
      2
    );

    // 4. Platform Offer Notification (no demo movie or theatre alerts)
    db.prepare(`
      INSERT OR IGNORE INTO notifications (id, type, title, message, target_user_id, is_read, channel)
      VALUES (?, ?, ?, ?, ?, 0, 'IN_APP')
    `).run(
      'ntf_2',
      'SPECIAL_OFFER',
      'Flat ₹100 Off with code ATMOS100',
      'Enjoy instant ₹100 off on bookings above ₹300 for all Dolby Atmos shows this week.',
      null
    );
  });

  tx();
}
