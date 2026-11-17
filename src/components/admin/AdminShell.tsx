import {
  Armchair,
  ArrowLeft,
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  CreditCard,
  Film,
  Grid3X3,
  IndianRupee,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Settings,
  ShieldCheck,
  Tag,
  Ticket,
  Users,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { apiFetch, setAuthToken } from '../../lib/api';
import type { AuthUser, UserRole } from '../../types';
import { TicketNowLogo } from '../BrandMark';
import { AdminBulkBooking } from './AdminBulkBooking';
import { AdminBulkBookingHistory } from './AdminBulkBookingHistory';
import { AdminDashboard } from './AdminDashboard';
import { AdminMoviesModule, AdminPricingModule, AdminShowsModule } from './AdminMoviesPricingShows';
import {
  AdminBookingsModule,
  AdminCustomersModule,
  AdminNotificationsModule,
  AdminOffersModule,
  AdminPaymentsModule,
  AdminReportsModule,
  AdminSettingsModule,
  AdminUsersModule,
} from './AdminOperations';
import { AdminBookingScheduleModule, AdminSeatAvailabilityModule } from './AdminScheduleSeats';
import { AdminScreensModule, AdminTheatresModule } from './AdminTheatresScreens';
import { ScreenLayoutDesigner } from './ScreenLayoutDesigner';

interface AdminShellProps {
  currentUser: AuthUser | null;
  onUserChange: (user: AuthUser | null) => void;
  onExitAdmin: () => void;
  onDataChanged: () => void;
}

const ADMIN_ROLES: UserRole[] = ['SUPER_ADMIN', 'THEATRE_ADMIN', 'BOOKING_MANAGER', 'ACCOUNTANT'];

interface NavItem {
  id: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: UserRole[];
}

const SIDEBAR_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ADMIN_ROLES },
  { id: 'theatres', label: 'Theatres', icon: Building2, roles: ['SUPER_ADMIN', 'THEATRE_ADMIN'] },
  { id: 'screens', label: 'Screens', icon: Monitor, roles: ['SUPER_ADMIN', 'THEATRE_ADMIN'] },
  { id: 'layout-designer', label: 'Screen Layout Designer', icon: Grid3X3, roles: ['SUPER_ADMIN', 'THEATRE_ADMIN'] },
  { id: 'movies', label: 'Movies', icon: Film, roles: ['SUPER_ADMIN'] },
  { id: 'pricing', label: 'Categories & Pricing', icon: IndianRupee, roles: ['SUPER_ADMIN', 'THEATRE_ADMIN'] },
  { id: 'shows', label: 'Shows', icon: CalendarDays, roles: ['SUPER_ADMIN', 'THEATRE_ADMIN', 'BOOKING_MANAGER'] },
  { id: 'booking-schedule', label: 'Booking Schedule', icon: CalendarClock, roles: ['SUPER_ADMIN', 'THEATRE_ADMIN'] },
  { id: 'seat-availability', label: 'Seat Availability', icon: Armchair, roles: ['SUPER_ADMIN', 'THEATRE_ADMIN', 'BOOKING_MANAGER'] },
  { id: 'bulk-booking', label: 'Bulk Booking', icon: Layers, roles: ['SUPER_ADMIN', 'THEATRE_ADMIN', 'BOOKING_MANAGER'] },
  { id: 'bulk-booking-history', label: 'Bulk Booking History', icon: ClipboardList, roles: ADMIN_ROLES },
  { id: 'bookings', label: 'Bookings', icon: Ticket, roles: ADMIN_ROLES },
  { id: 'customers', label: 'Customers', icon: Users, roles: ['SUPER_ADMIN', 'BOOKING_MANAGER'] },
  { id: 'payments', label: 'Payments', icon: CreditCard, roles: ['SUPER_ADMIN', 'ACCOUNTANT', 'BOOKING_MANAGER'] },
  { id: 'offers', label: 'Offers & Promotions', icon: Tag, roles: ['SUPER_ADMIN'] },
  { id: 'notifications', label: 'Notifications', icon: Bell, roles: ['SUPER_ADMIN', 'BOOKING_MANAGER'] },
  { id: 'reports', label: 'Reports & Analytics', icon: BarChart3, roles: ['SUPER_ADMIN', 'ACCOUNTANT', 'THEATRE_ADMIN'] },
  { id: 'admin-users', label: 'Admin Users', icon: ShieldCheck, roles: ['SUPER_ADMIN'] },
  { id: 'settings', label: 'Settings', icon: Settings, roles: ['SUPER_ADMIN'] },
];

const ROLE_PRESETS = [
  { role: 'Super Admin', email: 'admin@ticketnow.in', pass: 'Admin@123' },
  { role: 'Theatre Admin', email: 'ark.admin@ticketnow.in', pass: 'Theatre@123' },
  { role: 'Booking Manager', email: 'bookings@ticketnow.in', pass: 'Booking@123' },
  { role: 'Accountant', email: 'accounts@ticketnow.in', pass: 'Account@123' },
];

export function AdminShell({ currentUser, onUserChange, onExitAdmin, onDataChanged }: AdminShellProps) {
  const [activeModule, setActiveModule] = useState('dashboard');
  const [designerScreenId, setDesignerScreenId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Admin Login Form
  const [email, setEmail] = useState('admin@ticketnow.in');
  const [password, setPassword] = useState('Admin@123');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const isAdmin = currentUser && ADMIN_ROLES.includes(currentUser.role);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await apiFetch<{ token: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (!ADMIN_ROLES.includes(res.user.role)) {
        setAuthError('This account is a customer account. Please sign in with an administrator account.');
        return;
      }
      setAuthToken(res.token);
      onUserChange(res.user);
      setActiveModule('dashboard');
    } catch (err) {
      setAuthError((err as Error).message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setAuthToken(null);
    onUserChange(null);
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
          <div className="flex items-center justify-between">
            <TicketNowLogo />
            <button
              type="button"
              onClick={onExitAdmin}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-950"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Customer App
            </button>
          </div>

          <div>
            <h1 className="font-display font-bold text-xl text-slate-950">Super Admin Sign In</h1>
            <p className="text-xs text-slate-500 mt-1">
              Role-based access for Super Admin, Theatre Admin, Booking Manager &amp; Accountant
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Admin Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-emerald-600"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-emerald-600"
              />
            </div>
            {authError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs text-rose-700">
                {authError}
              </div>
            )}
            <button
              type="submit"
              disabled={authLoading}
              className="w-full h-11 rounded-xl bg-slate-950 hover:bg-slate-800 text-white font-display font-bold text-sm"
            >
              {authLoading ? 'Verifying...' : 'Sign In to Admin Panel'}
            </button>
          </form>

          <div className="pt-4 border-t border-slate-100 space-y-2">
            <div className="text-[11px] font-semibold text-slate-500">Quick-Fill Role Credentials</div>
            <div className="grid grid-cols-2 gap-2">
              {ROLE_PRESETS.map((p) => (
                <button
                  key={p.email}
                  type="button"
                  onClick={() => {
                    setEmail(p.email);
                    setPassword(p.pass);
                  }}
                  className="text-left p-2 rounded-lg border border-slate-200 hover:border-emerald-500 text-[11px] transition-colors"
                >
                  <div className="font-semibold text-slate-900">{p.role}</div>
                  <div className="font-mono text-slate-400 truncate">{p.email}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const permittedItems = SIDEBAR_ITEMS.filter(
    (item) => currentUser.role === 'SUPER_ADMIN' || item.roles.includes(currentUser.role)
  );
  const currentMeta = permittedItems.find((i) => i.id === activeModule) || permittedItems[0];

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full">
      <div className="px-5 h-14 border-b border-slate-200 flex items-center justify-between shrink-0">
        <TicketNowLogo compact />
        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          className="lg:hidden p-1.5 rounded-lg hover:bg-slate-100"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {permittedItems.map((item) => {
          const Icon = item.icon;
          const active = activeModule === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveModule(item.id);
                setDrawerOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                active
                  ? 'bg-slate-950 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
              }`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-emerald-400' : 'text-slate-400'}`} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-slate-200 space-y-2 shrink-0">
        <div className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs">
          <div className="font-semibold text-slate-950 truncate">{currentUser.name}</div>
          <div className="font-mono text-[10px] text-emerald-700 font-semibold">{currentUser.role}</div>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-slate-200 hover:bg-rose-50 hover:text-rose-700 text-xs font-semibold text-slate-700"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex w-64 bg-white border-r border-slate-200 flex-col sticky top-0 h-screen shrink-0">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Collapsible Drawer */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-slate-950/60 flex">
          <aside className="w-72 bg-white h-full shadow-2xl">{renderSidebarContent()}</aside>
          <div className="flex-1" onClick={() => setDrawerOpen(false)} />
        </div>
      )}

      {/* Main Admin Workspace */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open admin menu"
              className="lg:hidden w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center text-slate-700"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="text-sm font-display font-bold text-slate-950 truncate">
              Admin <span className="text-slate-300 font-normal mx-1">/</span> {currentMeta?.label}
            </div>
          </div>

          <button
            type="button"
            onClick={onExitAdmin}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 hover:border-slate-400 bg-white text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Customer App
          </button>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {activeModule === 'dashboard' && <AdminDashboard onNavigate={(id) => setActiveModule(id)} />}
          {activeModule === 'theatres' && <AdminTheatresModule onDataChanged={onDataChanged} />}
          {activeModule === 'screens' && (
            <AdminScreensModule
              onOpenLayoutDesigner={(sid) => {
                setDesignerScreenId(sid);
                setActiveModule('layout-designer');
              }}
              onDataChanged={onDataChanged}
            />
          )}
          {activeModule === 'layout-designer' && (
            <ScreenLayoutDesigner initialScreenId={designerScreenId} onDataChanged={onDataChanged} />
          )}
          {activeModule === 'movies' && <AdminMoviesModule onDataChanged={onDataChanged} />}
          {activeModule === 'pricing' && <AdminPricingModule onDataChanged={onDataChanged} />}
          {activeModule === 'shows' && <AdminShowsModule onDataChanged={onDataChanged} />}
          {activeModule === 'booking-schedule' && <AdminBookingScheduleModule onDataChanged={onDataChanged} />}
          {activeModule === 'seat-availability' && <AdminSeatAvailabilityModule onDataChanged={onDataChanged} />}
          {activeModule === 'bulk-booking' && (
            <AdminBulkBooking
              onDataChanged={onDataChanged}
              onOpenHistory={() => setActiveModule('bulk-booking-history')}
            />
          )}
          {activeModule === 'bulk-booking-history' && (
            <AdminBulkBookingHistory
              onDataChanged={onDataChanged}
              onCreateNew={() => setActiveModule('bulk-booking')}
            />
          )}
          {activeModule === 'bookings' && <AdminBookingsModule onDataChanged={onDataChanged} />}
          {activeModule === 'customers' && <AdminCustomersModule />}
          {activeModule === 'payments' && <AdminPaymentsModule />}
          {activeModule === 'offers' && <AdminOffersModule onDataChanged={onDataChanged} />}
          {activeModule === 'notifications' && <AdminNotificationsModule onDataChanged={onDataChanged} />}
          {activeModule === 'reports' && <AdminReportsModule />}
          {activeModule === 'admin-users' && <AdminUsersModule />}
          {activeModule === 'settings' && <AdminSettingsModule onDataChanged={onDataChanged} />}
        </main>
      </div>
    </div>
  );
}
