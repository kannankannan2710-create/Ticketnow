import {
  Bell,
  ChevronRight,
  FileText,
  HelpCircle,
  LogIn,
  LogOut,
  Pencil,
  Shield,
  Ticket,
  User,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type { AppSettings, AuthUser } from '../../types';
import { apiFetch } from '../../lib/api';

interface ProfilePageProps {
  currentUser: AuthUser | null;
  settings: AppSettings | null;
  unreadNotifications: number;
  onUserChange: (user: AuthUser | null) => void;
  onSignOut: () => void;
  onOpenAuthModal: () => void;
  onOpenBookings: () => void;
  onOpenNotifications: () => void;
  onOpenAdminPanel: () => void;
}

export function ProfilePage({
  currentUser,
  settings,
  unreadNotifications,
  onUserChange,
  onSignOut,
  onOpenAuthModal,
  onOpenBookings,
  onOpenNotifications,
  onOpenAdminPanel,
}: ProfilePageProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(currentUser?.name || '');
  const [editMobile, setEditMobile] = useState(currentUser?.mobile || '');
  const [editCity, setEditCity] = useState(currentUser?.city || 'Tirunelveli');
  const [saving, setSaving] = useState(false);
  const [infoModal, setInfoModal] = useState<'HELP' | 'TERMS' | null>(null);

  const openEdit = () => {
    if (!currentUser) {
      onOpenAuthModal();
      return;
    }
    setEditName(currentUser.name);
    setEditMobile(currentUser.mobile);
    setEditCity(currentUser.city);
    setEditOpen(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch<{ user: AuthUser }>('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ name: editName, mobile: editMobile, city: editCity }),
      });
      onUserChange(res.user);
      setEditOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const initials = currentUser
    ? currentUser.name
        .split(' ')
        .map((p) => p[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'TN';

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-5 pb-24 md:pb-12 space-y-6">
      {/* User Identity Card */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-14 h-14 rounded-2xl bg-slate-950 text-white font-display font-bold text-lg flex items-center justify-center shrink-0">
            {currentUser ? initials : <User className="w-6 h-6" />}
          </div>
          <div className="min-w-0">
            <h1 className="font-display font-bold text-lg text-slate-950 truncate">
              {currentUser ? currentUser.name : 'Welcome to TICKETNOW'}
            </h1>
            {currentUser ? (
              <>
                <p className="text-xs sm:text-sm text-slate-600 font-mono truncate">{currentUser.mobile}</p>
                <p className="text-xs text-slate-400 truncate">
                  {currentUser.email} · {currentUser.city}
                </p>
              </>
            ) : (
              <p className="text-xs sm:text-sm text-slate-500">
                Sign in to sync your bookings, favourites, and instant QR passes.
              </p>
            )}
          </div>
        </div>

        {currentUser ? (
          <button
            type="button"
            onClick={openEdit}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 hover:border-slate-400 text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0 min-h-[42px]"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit Profile
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpenAuthModal}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 min-h-[42px]"
          >
            <LogIn className="w-4 h-4" />
            Sign In
          </button>
        )}
      </section>

      {/* Enterprise Super Admin Portal Access */}
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display font-bold text-sm sm:text-base text-slate-950">
              Super Admin &amp; Cinema Control Center
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Manage theatres, screens, Schema v2.0 layout designer, dynamic pricing, advance booking schedules &amp; reports.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenAdminPanel}
          className="px-4 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 min-h-[42px]"
        >
          Open Admin Panel
        </button>
      </section>

      {/* Menu Rows */}
      <section className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
        <button
          type="button"
          onClick={onOpenBookings}
          className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
        >
          <span className="flex items-center gap-3">
            <Ticket className="w-5 h-5 text-slate-500" />
            <span className="text-sm font-medium text-slate-900">My Bookings</span>
          </span>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </button>

        <button
          type="button"
          onClick={onOpenNotifications}
          className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
        >
          <span className="flex items-center gap-3">
            <Bell className="w-5 h-5 text-slate-500" />
            <span className="text-sm font-medium text-slate-900">Notifications</span>
          </span>
          <span className="flex items-center gap-2">
            {unreadNotifications > 0 && (
              <span className="text-xs font-mono font-semibold text-emerald-700">
                {unreadNotifications} new
              </span>
            )}
            <ChevronRight className="w-4 h-4 text-slate-400" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => setInfoModal('HELP')}
          className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
        >
          <span className="flex items-center gap-3">
            <HelpCircle className="w-5 h-5 text-slate-500" />
            <span className="text-sm font-medium text-slate-900">Help &amp; Support</span>
          </span>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </button>

        <button
          type="button"
          onClick={() => setInfoModal('TERMS')}
          className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
        >
          <span className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-slate-500" />
            <span className="text-sm font-medium text-slate-900">Terms, Cancellation &amp; Privacy</span>
          </span>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </button>

        {currentUser && (
          <button
            type="button"
            onClick={onSignOut}
            className="w-full px-5 py-4 flex items-center justify-between hover:bg-rose-50 transition-colors text-left text-rose-700"
          >
            <span className="flex items-center gap-3">
              <LogOut className="w-5 h-5" />
              <span className="text-sm font-semibold">Sign Out</span>
            </span>
          </button>
        )}
      </section>

      {/* Edit Profile Modal */}
      {editOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveProfile}
            className="bg-white w-full max-w-md rounded-2xl border border-slate-200 p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-base text-slate-950">Edit Profile</h2>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-emerald-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Mobile Number</label>
                <input
                  type="tel"
                  required
                  value={editMobile}
                  onChange={(e) => setEditMobile(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-emerald-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">City</label>
                <input
                  type="text"
                  required
                  value={editCity}
                  onChange={(e) => setEditCity(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-emerald-600"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Help & Support / Terms Modal */}
      {infoModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl border border-slate-200 p-5 space-y-4 shadow-xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-base text-slate-950">
                {infoModal === 'HELP' ? 'Help & Support' : 'Terms, Cancellation & Privacy'}
              </h2>
              <button
                type="button"
                onClick={() => setInfoModal(null)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {infoModal === 'HELP' ? (
              <div className="space-y-3 text-sm text-slate-600">
                <p>
                  <strong className="text-slate-950">Support Desk:</strong>{' '}
                  {settings?.contact_phone || '+91 4633 224 890'}
                </p>
                <p>
                  <strong className="text-slate-950">Email:</strong>{' '}
                  {settings?.contact_email || 'support@ticketnow.in'}
                </p>
                <p>
                  <strong className="text-slate-950">Hours:</strong>{' '}
                  {settings?.support_hours || '08:00 AM – 11:30 PM IST'}
                </p>
                <p className="pt-2 border-t border-slate-100 text-xs text-slate-500">
                  For instant booking assistance, keep your Booking ID (e.g. TN-261117-8041) ready.
                </p>
              </div>
            ) : (
              <div className="space-y-4 text-sm text-slate-600 leading-relaxed">
                <div>
                  <h3 className="font-display font-bold text-slate-950 text-xs uppercase tracking-wide mb-1">
                    Cancellation Policy
                  </h3>
                  <p>{settings?.cancellation_policy}</p>
                </div>
                <div>
                  <h3 className="font-display font-bold text-slate-950 text-xs uppercase tracking-wide mb-1">
                    Terms &amp; Conditions
                  </h3>
                  <p>{settings?.terms_text}</p>
                </div>
                <div>
                  <h3 className="font-display font-bold text-slate-950 text-xs uppercase tracking-wide mb-1">
                    Privacy Policy
                  </h3>
                  <p>{settings?.privacy_text}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
