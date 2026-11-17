export type UserRole =
  | 'CUSTOMER'
  | 'SUPER_ADMIN'
  | 'THEATRE_ADMIN'
  | 'BOOKING_MANAGER'
  | 'ACCOUNTANT';

export type MovieStatus = 'NOW_SHOWING' | 'UPCOMING' | 'COMPLETED' | 'INACTIVE';

export type BookingWindowStatus = 'OPEN' | 'CLOSED' | 'SCHEDULED';

export type AvailabilityIndicator =
  | 'AVAILABLE'
  | 'FAST_FILLING'
  | 'ALMOST_FULL'
  | 'SOLD_OUT'
  | 'BOOKING_NOT_OPEN'
  | 'BOOKING_CLOSED'
  | 'COMING_SOON';

export type SeatType = 'NORMAL' | 'COUPLE' | 'RECLINER' | 'SOFA' | 'WHEELCHAIR';
export type SeatBlock = 'LEFT' | 'CENTRE' | 'RIGHT';
export type SeatVisualState = 'AVAILABLE' | 'OCCUPIED' | 'SELECTED' | 'BLOCKED' | 'LOCKED';

export interface LayoutCategory {
  id: string;
  name: string;
  color: string;
  price: number;
  rows: string[];
}

export interface LayoutRow {
  label: string;
  y: number;
  category_id: string;
}

export interface LayoutSeat {
  id: string;
  row: string;
  number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  category_id: string;
  seat_type: SeatType;
  block: SeatBlock;
  price_override?: number | null;
  status?: 'AVAILABLE' | 'OCCUPIED' | 'BLOCKED' | 'LOCKED' | 'DISABLED';
}

export interface LayoutAisle {
  id: string;
  orientation: 'vertical' | 'horizontal';
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
}

export interface ScreenLayoutV2 {
  schema_version: '2.0';
  theatre_id: string;
  theatre_name: string;
  screen_id: string;
  screen_name: string;
  screen_width: number;
  screen_height: number;
  screen_direction: 'BOTTOM' | 'TOP';
  coordinate_system: 'cartesian_px';
  categories: LayoutCategory[];
  rows: LayoutRow[];
  seats: LayoutSeat[];
  aisles: LayoutAisle[];
  blocked_seats?: string[];
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  mobile: string;
  role: UserRole;
  assigned_theatre_id: string | null;
  city: string;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: string;
}

export interface Theatre {
  id: string;
  name: string;
  logo_code: string;
  logo_url: string | null;
  image_url: string | null;
  address: string;
  city: string;
  district: string;
  maps_location: string;
  distance_km: number;
  contact_number: string;
  facilities: string[];
  cancellation_policy: string;
  is_cancellable: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  screen_count?: number;
  active_show_count?: number;
  is_favourite?: boolean;
  created_at?: string;
}

export interface Screen {
  id: string;
  theatre_id: string;
  theatre_name?: string;
  screen_number: number;
  name: string;
  screen_type: string;
  sound_system: string;
  projection_type: string;
  capacity: number;
  image_url: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  layout: ScreenLayoutV2;
  updated_at?: string;
}

export interface CastMember {
  name: string;
  role: string;
}

export interface MovieHomepageShowTiming {
  show_id: string;
  show_date: string;
  start_time: string;
  theatre_id: string;
  theatre_name: string;
  theatre_logo_code: string;
  screen_name: string;
  format: string;
  sound_system: string;
  available_seats: number;
  indicator: AvailabilityIndicator;
  min_price: number;
}

export interface MovieScheduleSummary {
  city: string;
  formats: string[];
  theatre_names: string[];
  dates: string[];
  timings: MovieHomepageShowTiming[];
}

export interface MovieBookingAvailability {
  state: 'OPEN' | 'SCHEDULED' | 'CLOSED' | 'COMING_SOON' | 'NO_SHOWS';
  label: string;
  can_book: boolean;
  opens_at: string | null;
  closes_at: string | null;
  max_advance_days: number;
  announcement: string | null;
  eligible_dates: string[];
  min_price: number | null;
  active_show_count: number;
  schedule_summary?: MovieScheduleSummary;
}

export interface Movie {
  id: string;
  title: string;
  language: string;
  genre: string;
  certification: string;
  duration_mins: number;
  release_date: string;
  poster_url: string;
  banner_url: string | null;
  trailer_url: string | null;
  description: string;
  cast: CastMember[];
  crew: CastMember[];
  rating: number | null;
  is_top_selling: boolean;
  status: MovieStatus;
  created_at?: string;
  availability?: MovieBookingAvailability;
}

export interface BookingWindow {
  id: string;
  scope_type: 'GLOBAL' | 'MOVIE' | 'SHOW';
  scope_id: string;
  scope_label?: string;
  booking_open_at: string;
  booking_close_at: string;
  advance_enabled: boolean;
  max_advance_days: number;
  advance_start_date: string | null;
  advance_end_date: string | null;
  status: BookingWindowStatus;
  announcement_text: string | null;
  updated_at?: string;
}

export interface MoviePricingRule {
  id: string;
  movie_id: string;
  movie_title?: string;
  theatre_id: string | null;
  theatre_name?: string | null;
  screen_id: string | null;
  screen_name?: string | null;
  show_id: string | null;
  category_id: string;
  category_name?: string;
  price: number;
  updated_at?: string;
}

export interface ShowAvailabilityMetrics {
  total_seats: number;
  sellable_seats: number;
  available_seats: number;
  booked_seats: number;
  blocked_seats: number;
  locked_seats: number;
  availability_pct: number;
  indicator: AvailabilityIndicator;
  booking_open: boolean;
  booking_state: 'OPEN' | 'SCHEDULED' | 'CLOSED';
  opens_at: string | null;
  closes_at: string | null;
  min_price: number;
}

export interface Show {
  id: string;
  movie_id: string;
  movie_title?: string;
  movie_poster?: string;
  theatre_id: string;
  theatre_name?: string;
  theatre_address?: string;
  theatre_city?: string;
  theatre_distance_km?: number;
  theatre_is_cancellable?: boolean;
  theatre_cancellation_policy?: string;
  theatre_logo_code?: string;
  theatre_facilities?: string[];
  screen_id: string;
  screen_name?: string;
  screen_number?: number;
  show_date: string;
  start_time: string;
  end_time: string;
  language: string;
  format: string;
  sound_system: string;
  status: 'ACTIVE' | 'INACTIVE' | 'CANCELLED';
  booking_open_at: string | null;
  booking_close_at: string | null;
  metrics?: ShowAvailabilityMetrics;
}

export interface ResolvedSeat extends LayoutSeat {
  category_name: string;
  category_color: string;
  resolved_price: number;
  price_source: 'SEAT_OVERRIDE' | 'SHOW_CATEGORY' | 'MOVIE_CATEGORY' | 'SCREEN_DEFAULT';
  status: 'AVAILABLE' | 'OCCUPIED' | 'BLOCKED' | 'LOCKED';
  locked_by_me?: boolean;
  lock_expires_at?: string | null;
}

export interface ShowSeatMapResponse {
  show: Show;
  movie: Movie;
  theatre: Theatre;
  screen: Omit<Screen, 'layout'>;
  layout: ScreenLayoutV2;
  categories: Array<LayoutCategory & { resolved_price: number; available_count: number }>;
  seats: ResolvedSeat[];
  metrics: ShowAvailabilityMetrics;
  sibling_shows: Array<{
    id: string;
    start_time: string;
    screen_name: string;
    format: string;
    sound_system: string;
    indicator: AvailabilityIndicator;
    available_seats: number;
  }>;
  settings: {
    convenience_fee_per_seat: number;
    tax_rate_percent: number;
    lock_duration_seconds: number;
  };
}

export interface BookingSeatSnapshot {
  seat_id: string;
  row: string;
  number: number;
  category_id: string;
  category_name: string;
  unit_price: number;
  price_source: string;
}

export interface BookingRecord {
  id: string;
  booking_code: string;
  user_id: string | null;
  customer_name: string;
  customer_mobile: string;
  customer_email: string;
  movie_id: string;
  movie_title: string;
  movie_poster: string;
  movie_certification: string;
  movie_language: string;
  theatre_id: string;
  theatre_name: string;
  theatre_address: string;
  theatre_is_cancellable: boolean;
  screen_id: string;
  screen_name: string;
  screen_number: number;
  show_id: string;
  show_date: string;
  show_time: string;
  seats: BookingSeatSnapshot[];
  seat_count: number;
  subtotal: number;
  discount_amount: number;
  offer_code: string | null;
  convenience_fee: number;
  tax_amount: number;
  total_amount: number;
  payment_status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
  booking_status: 'CONFIRMED' | 'CANCELLED' | 'PENDING';
  qr_payload: string;
  transaction_id?: string | null;
  payment_gateway?: string | null;
  created_at: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
}

export interface Offer {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  banner_url: string;
  cta_label: string;
  coupon_code: string;
  discount_type: 'FLAT' | 'PERCENT';
  discount_value: number;
  min_booking_amount: number;
  max_discount: number;
  start_date: string;
  expiry_date: string;
  is_active: boolean;
  display_order: number;
}

export interface NotificationItem {
  id: string;
  type:
    | 'BOOKING_CONFIRMATION'
    | 'BOOKING_CANCELLATION'
    | 'PAYMENT_CONFIRMATION'
    | 'MOVIE_ANNOUNCEMENT'
    | 'NEW_RELEASE'
    | 'SPECIAL_OFFER'
    | 'BOOKING_OPENING';
  title: string;
  message: string;
  target_user_id: string | null;
  is_read: boolean;
  channel: 'IN_APP' | 'SMS' | 'EMAIL' | 'ALL';
  created_at: string;
}

export interface PaymentRecord {
  id: string;
  transaction_id: string;
  booking_id: string;
  booking_code?: string;
  customer_name?: string;
  customer_mobile?: string;
  movie_title?: string;
  theatre_name?: string;
  gateway: string;
  method: string;
  amount: number;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
  refund_amount: number;
  refund_status: 'NONE' | 'INITIATED' | 'PROCESSED';
  verified_at: string | null;
  created_at: string;
}

export interface AppSettings {
  app_name: string;
  app_logo_url: string;
  contact_email: string;
  contact_phone: string;
  support_hours: string;
  currency: string;
  convenience_fee_per_seat: number;
  tax_rate_percent: number;
  cancellation_policy: string;
  terms_text: string;
  privacy_text: string;
  lock_duration_seconds: number;
}

export interface AuditLog {
  id: string;
  admin_user_id: string;
  admin_name: string;
  admin_role: UserRole;
  action: string;
  entity_type: string;
  entity_id: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface LayoutValidationIssue {
  line: number;
  field: string;
  message: string;
}

export interface BulkBookingTicket {
  id: string;
  bulk_booking_id: string;
  booking_id: string;
  booking_code?: string;
  ticket_number: string;
  show_id: string;
  seat_id: string;
  row_label: string;
  seat_number: number;
  category_id: string;
  category_name: string;
  unit_price: number;
  customer_name: string;
  customer_mobile: string;
  customer_email: string;
  qr_payload: string;
  ticket_status: 'CONFIRMED' | 'CANCELLED';
  created_at: string;
}

export interface BulkBookingRecord {
  id: string;
  bulk_code: string;
  mode: 'SINGLE_CUSTOMER' | 'MULTIPLE_CUSTOMERS';
  reference_code: string;
  theatre_id: string;
  theatre_name: string;
  theatre_address?: string;
  screen_id: string;
  screen_name: string;
  screen_number: number;
  movie_id: string;
  movie_title: string;
  movie_language?: string;
  movie_certification?: string;
  show_id: string;
  show_date: string;
  show_time: string;
  primary_customer_name: string;
  primary_customer_mobile: string;
  primary_customer_email: string;
  customer_count: number;
  total_tickets: number;
  subtotal: number;
  convenience_fee: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  payment_method: string;
  payment_status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
  booking_status: 'CONFIRMED' | 'CANCELLED';
  created_by_admin_id: string;
  created_by_admin_name: string;
  created_at: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  booking_codes: string[];
  tickets: BulkBookingTicket[];
}

export interface BulkCustomerAssignment {
  id: string;
  name: string;
  mobile: string;
  email: string;
  seat_ids: string[];
}

