const TOKEN_KEY = 'ticketnow_auth_token';
const SESSION_KEY = 'ticketnow_seat_session';
const GUEST_CODES_KEY = 'ticketnow_guest_booking_codes';

export function getAuthToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setAuthToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function getSeatSessionKey(): string {
  let existing = localStorage.getItem(SESSION_KEY);
  if (!existing) {
    existing = `sess_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem(SESSION_KEY, existing);
  }
  return existing;
}

export function getGuestBookingCodes(): string[] {
  try {
    const raw = localStorage.getItem(GUEST_CODES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveGuestBookingCode(code: string): void {
  const existing = getGuestBookingCodes();
  if (!existing.includes(code)) {
    localStorage.setItem(GUEST_CODES_KEY, JSON.stringify([code, ...existing].slice(0, 30)));
  }
}

export async function apiFetch<T = unknown>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!res.ok) {
    const errObj = data as { error?: string; validation_errors?: string[] };
    const detail = errObj?.validation_errors?.length
      ? `${errObj.error || 'Validation failed'}: ${errObj.validation_errors.join(' ')}`
      : errObj?.error || `Request failed (${res.status})`;
    throw new Error(detail);
  }

  return data as T;
}

export async function downloadAdminReport(
  type: string,
  format: 'csv' | 'xlsx',
  from?: string,
  to?: string
): Promise<void> {
  const params = new URLSearchParams({ type, format });
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const token = getAuthToken();
  const res = await fetch(`/api/admin/reports/export?${params.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new Error('Failed to export report.');
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = `ticketnow-${type}-report.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export async function downloadBulkBookingsReport(
  format: 'csv' | 'xlsx',
  filters: { q?: string; date?: string; movie_id?: string } = {}
): Promise<void> {
  const params = new URLSearchParams({ format });
  if (filters.q) params.set('q', filters.q);
  if (filters.date) params.set('date', filters.date);
  if (filters.movie_id) params.set('movie_id', filters.movie_id);

  const token = getAuthToken();
  const res = await fetch(`/api/admin/bulk-bookings/export?${params.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new Error('Failed to export bulk bookings report.');
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = `ticketnow-bulk-bookings.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

