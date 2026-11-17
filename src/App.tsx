/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Bell,
  Building2,
  Check,
  ChevronDown,
  Clapperboard,
  Film,
  MapPin,
  Monitor,
  Search,
  Shield,
  Ticket,
  User,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminShell } from './components/admin/AdminShell';
import { MoviePosterImage, TicketNowLogo } from './components/BrandMark';
import { BookingsPage } from './components/customer/BookingsPage';
import { HomePage } from './components/customer/HomePage';
import { MovieDetailsPage } from './components/customer/MovieDetailsPage';
import { ProfilePage } from './components/customer/ProfilePage';
import { SeatSelectionPage } from './components/customer/SeatSelectionPage';
import { ShowSelectionPage } from './components/customer/ShowSelectionPage';
import { TheatresPage } from './components/customer/TheatresPage';
import { apiFetch, getAuthToken, setAuthToken } from './lib/api';
import { formatDuration } from './lib/format';
import type {
  AppSettings,
  AuthUser,
  BookingRecord,
  Movie,
  NotificationItem,
  Offer,
  Theatre,
} from './types';

type AppView =
  | 'HOME'
  | 'THEATRES'
  | 'BOOKINGS'
  | 'PROFILE'
  | 'MOVIE_DETAILS'
  | 'SHOWS'
  | 'SEATS'
  | 'ADMIN';

interface BootstrapPayload {
  settings: AppSettings;
  cities: string[];
  offers: Offer[];
  notifications: NotificationItem[];
  server_time: string;
}

interface MoviesPayload {
  now_showing: Movie[];
  upcoming: Movie[];
  all: Movie[];
  server_time: string;
}

const PRIMARY_TABS: Array<{ id: 'HOME' | 'THEATRES' | 'BOOKINGS' | 'PROFILE'; label: string; icon: typeof Clapperboard }> = [
  { id: 'HOME', label: 'Movies', icon: Clapperboard },
  { id: 'THEATRES', label: 'Theatres', icon: Monitor },
  { id: 'BOOKINGS', label: 'Bookings', icon: Ticket },
  { id: 'PROFILE', label: 'Profile', icon: User },
];

export default function App() {
  const initialAdminMode =
    typeof window !== 'undefined' &&
    (window.location.pathname.startsWith('/admin') || window.location.hash.startsWith('#/admin'));

  const [view, setView] = useState<AppView>(initialAdminMode ? 'ADMIN' : 'HOME');
  const [returnToView, setReturnToView] = useState<AppView>('HOME');

  // Core data from SQLite backend (default Tirunelveli)
  const [selectedCity, setSelectedCity] = useState<string>('Tirunelveli');
  const [cities, setCities] = useState<string[]>(['Tirunelveli']);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [nowShowing, setNowShowing] = useState<Movie[]>([]);
  const [upcoming, setUpcoming] = useState<Movie[]>([]);
  const [allMovies, setAllMovies] = useState<Movie[]>([]);
  const [theatres, setTheatres] = useState<Theatre[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState<boolean>(true);
  const [refreshSignal, setRefreshSignal] = useState<number>(0);

  // Auth state
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

  // Navigation context
  const [selectedMovieId, setSelectedMovieId] = useState<string | null>(null);
  const [selectedMovieSnapshot, setSelectedMovieSnapshot] = useState<Movie | null>(null);
  const [selectedShowDate, setSelectedShowDate] = useState<string | undefined>(undefined);
  const [selectedShowId, setSelectedShowId] = useState<string | null>(null);
  const [selectedTheatreId, setSelectedTheatreId] = useState<string | null>(null);

  // Header overlays & modals
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [cityModalOpen, setCityModalOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  const [authName, setAuthName] = useState('');
  const [authMobile, setAuthMobile] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Sync hash / path listener for #/admin
  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash.startsWith('#/admin')) {
        setView('ADMIN');
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Restore session if token exists
  useEffect(() => {
    if (!getAuthToken()) return;
    apiFetch<{ user: AuthUser | null }>('/api/auth/me')
      .then((res) => {
        if (res.user) {
          setCurrentUser(res.user);
        } else {
          setAuthToken(null);
        }
      })
      .catch(() => {
        setAuthToken(null);
      });
  }, []);

  // Load bootstrap, movies & theatres
  const loadCatalog = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setLoadingCatalog(true);
      }
      try {
        const cityParam = selectedCity
          ? `?city=${encodeURIComponent(selectedCity)}`
          : '?city=Tirunelveli';
        const theatreCityParam =
          selectedCity && selectedCity !== 'All Cities'
            ? `?city=${encodeURIComponent(selectedCity)}`
            : '';
        const [boot, mov, th] = await Promise.all([
          apiFetch<BootstrapPayload>('/api/bootstrap'),
          apiFetch<MoviesPayload>(`/api/movies${cityParam}`),
          apiFetch<{ theatres: Theatre[] }>(`/api/theatres${theatreCityParam}`),
        ]);
        setSettings(boot.settings);
        setCities(boot.cities.length > 0 ? boot.cities : ['Tirunelveli']);
        setOffers(boot.offers);
        setNotifications(boot.notifications);
        setNowShowing(mov.now_showing);
        setUpcoming(mov.upcoming);
        setAllMovies(mov.all);
        setTheatres(th.theatres);
      } catch {
        // Keep last known catalog on transient errors
      } finally {
        if (!options?.silent) {
          setLoadingCatalog(false);
        }
      }
    },
    [selectedCity]
  );

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog, refreshSignal, currentUser?.id]);

  // Real-time synchronization: silently refresh homepage catalog on tab focus/visibility and every 45s
  useEffect(() => {
    if (view !== 'HOME' && view !== 'THEATRES') return;
    const handleSync = () => {
      if (document.visibilityState === 'visible') {
        loadCatalog({ silent: true });
      }
    };
    window.addEventListener('focus', handleSync);
    document.addEventListener('visibilitychange', handleSync);
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadCatalog({ silent: true });
      }
    }, 45000);
    return () => {
      window.removeEventListener('focus', handleSync);
      document.removeEventListener('visibilitychange', handleSync);
      window.clearInterval(intervalId);
    };
  }, [view, loadCatalog]);

  // Keep active selectedMovie fresh when catalog reloads
  const activeMovie = useMemo(() => {
    if (selectedMovieId) {
      const found = allMovies.find((m) => m.id === selectedMovieId);
      if (found) return found;
    }
    return selectedMovieSnapshot;
  }, [allMovies, selectedMovieId, selectedMovieSnapshot]);

  const unreadNotifications = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications]
  );

  // Instant search results across movies & theatres
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return {
        movies: nowShowing.slice(0, 4),
        theatres: theatres.slice(0, 3),
      };
    }
    return {
      movies: allMovies.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          m.language.toLowerCase().includes(q) ||
          m.genre.toLowerCase().includes(q)
      ),
      theatres: theatres.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.address.toLowerCase().includes(q) ||
          t.city.toLowerCase().includes(q) ||
          t.facilities.some((f) => f.toLowerCase().includes(q))
      ),
    };
  }, [searchQuery, allMovies, nowShowing, theatres]);

  const scrollTop = () => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Navigation handlers
  const handleSelectMovie = (movie: Movie) => {
    setSelectedMovieId(movie.id);
    setSelectedMovieSnapshot(movie);
    setReturnToView(view === 'SHOWS' ? 'SHOWS' : 'HOME');
    setView('MOVIE_DETAILS');
    scrollTop();
  };

  const handleBookMovie = (movie: Movie, preferredDate?: string) => {
    setSelectedMovieId(movie.id);
    setSelectedMovieSnapshot(movie);
    setSelectedShowDate(preferredDate);
    setReturnToView(view === 'MOVIE_DETAILS' ? 'MOVIE_DETAILS' : 'HOME');
    setView('SHOWS');
    scrollTop();
  };

  const handleSelectShow = (showId: string) => {
    setSelectedShowId(showId);
    setReturnToView(view === 'THEATRES' ? 'THEATRES' : view === 'HOME' ? 'HOME' : 'SHOWS');
    setView('SEATS');
    scrollTop();
  };

  const handleSelectTheatre = (theatre: Theatre) => {
    setSelectedTheatreId(theatre.id);
    setView('THEATRES');
    scrollTop();
  };

  const handleOpenPrimaryTab = (tab: 'HOME' | 'THEATRES' | 'BOOKINGS' | 'PROFILE') => {
    if (tab === 'THEATRES') {
      setSelectedTheatreId(null);
    }
    setView(tab);
    scrollTop();
  };

  const handleBookingComplete = (_booking: BookingRecord) => {
    setRefreshSignal((s) => s + 1);
    setView('BOOKINGS');
    scrollTop();
  };

  const handleOpenNotifications = async () => {
    setNotificationsOpen(true);
    if (unreadNotifications > 0) {
      try {
        await apiFetch('/api/notifications/mark-read', { method: 'POST' });
        setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      } catch {
        // Non-blocking
      }
    }
  };

  const handleSignOut = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setAuthToken(null);
    setCurrentUser(null);
    setRefreshSignal((s) => s + 1);
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthSubmitting(true);
    setAuthError(null);
    try {
      if (authMode === 'LOGIN') {
        const res = await apiFetch<{ token: string; user: AuthUser }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: authEmail, password: authPassword }),
        });
        setAuthToken(res.token);
        setCurrentUser(res.user);
      } else {
        const res = await apiFetch<{ token: string; user: AuthUser }>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            name: authName,
            email: authEmail,
            mobile: authMobile,
            password: authPassword,
            city: selectedCity === 'All Cities' ? 'Tirunelveli' : selectedCity,
          }),
        });
        setAuthToken(res.token);
        setCurrentUser(res.user);
      }
      setAuthModalOpen(false);
      setAuthPassword('');
      setRefreshSignal((s) => s + 1);
    } catch (err) {
      setAuthError((err as Error).message);
    } finally {
      setAuthSubmitting(false);
    }
  };

  const openAdminPortal = () => {
    setView('ADMIN');
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '#/admin');
    }
  };

  const exitAdminPortal = () => {
    setRefreshSignal((s) => s + 1);
    setView('HOME');
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/');
    }
    scrollTop();
  };

  // Dedicated full-screen Admin Shell
  if (view === 'ADMIN') {
    return (
      <AdminShell
        currentUser={currentUser}
        onUserChange={(u) => setCurrentUser(u)}
        onExitAdmin={exitAdminPortal}
        onDataChanged={() => setRefreshSignal((s) => s + 1)}
      />
    );
  }

  // Dedicated full-screen booking flow pages (with their own focused headers)
  if (view === 'MOVIE_DETAILS' && activeMovie) {
    return (
      <MovieDetailsPage
        movie={activeMovie}
        onBack={() => {
          setView(returnToView === 'SHOWS' ? 'SHOWS' : 'HOME');
          scrollTop();
        }}
        onBookTickets={(movie, date) => handleBookMovie(movie, date)}
      />
    );
  }

  if (view === 'SHOWS' && selectedMovieId) {
    return (
      <ShowSelectionPage
        movieId={selectedMovieId}
        initialDate={selectedShowDate}
        selectedCity={selectedCity}
        isAuthenticated={Boolean(currentUser)}
        onBack={() => {
          setView(returnToView === 'MOVIE_DETAILS' && activeMovie ? 'MOVIE_DETAILS' : 'HOME');
          scrollTop();
        }}
        onViewMovieDetails={(movie) => handleSelectMovie(movie)}
        onSelectShow={(showId) => handleSelectShow(showId)}
        onRequireAuth={() => {
          setAuthMode('LOGIN');
          setAuthModalOpen(true);
        }}
      />
    );
  }

  if (view === 'SEATS' && selectedShowId) {
    return (
      <SeatSelectionPage
        showId={selectedShowId}
        currentUser={currentUser}
        onBack={() => {
          setView(
            returnToView === 'HOME'
              ? 'HOME'
              : returnToView === 'THEATRES'
                ? 'THEATRES'
                : selectedMovieId
                  ? 'SHOWS'
                  : 'HOME'
          );
          scrollTop();
        }}
        onSwitchShow={(newShowId) => setSelectedShowId(newShowId)}
        onBookingComplete={handleBookingComplete}
      />
    );
  }

  const activePrimaryTab: 'HOME' | 'THEATRES' | 'BOOKINGS' | 'PROFILE' =
    view === 'THEATRES' || view === 'BOOKINGS' || view === 'PROFILE' ? view : 'HOME';

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col">
      {/* Compact Sticky Top Header (Single-Row, Pure White, Obsidian + Emerald) */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200/90">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          {/* Left: TICKETNOW Brand Mark */}
          <button
            type="button"
            onClick={() => handleOpenPrimaryTab('HOME')}
            className="inline-flex items-center shrink-0 focus:outline-none"
            aria-label="TICKETNOW Home"
          >
            <TicketNowLogo />
          </button>

          {/* Center: Clean Desktop Navigation Links */}
          <nav className="hidden md:flex items-center gap-6" aria-label="Primary">
            {PRIMARY_TABS.map((tab) => {
              const isActive = activePrimaryTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleOpenPrimaryTab(tab.id)}
                  className={`relative h-14 inline-flex items-center text-sm font-semibold whitespace-nowrap shrink-0 transition-colors ${
                    isActive ? 'text-emerald-700' : 'text-slate-600 hover:text-slate-950'
                  }`}
                >
                  {tab.label}
                  {isActive && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600 rounded-full" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Right: Search, Location Selector (Tirunelveli), Notifications, Desktop Admin */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSearchOpen(true);
              }}
              aria-label="Search movies and theatres"
              className="w-9 h-9 sm:w-auto sm:px-2.5 rounded-xl flex items-center justify-center gap-1.5 text-slate-700 hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              <Search className="w-[18px] h-[18px] shrink-0" />
              <span className="hidden lg:inline text-xs font-medium text-slate-600">Search</span>
            </button>

            <button
              type="button"
              onClick={() => setCityModalOpen(true)}
              className="h-9 px-2.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-white text-slate-900 inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors"
              aria-label="Change city"
            >
              <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span className="max-w-[82px] truncate">{selectedCity}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </button>

            <button
              type="button"
              onClick={handleOpenNotifications}
              aria-label="Notifications"
              className="relative w-9 h-9 rounded-xl flex items-center justify-center text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
            >
              <Bell className="w-[18px] h-[18px]" />
              {unreadNotifications > 0 && (
                <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center leading-none tabular-nums">
                  {unreadNotifications > 9 ? '9+' : unreadNotifications}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={openAdminPortal}
              className="hidden lg:inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-slate-950 hover:bg-slate-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 transition-colors"
            >
              <Shield className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              Admin
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1">
        {activePrimaryTab === 'HOME' && (
          <HomePage
            nowShowing={nowShowing}
            upcoming={upcoming}
            theatres={theatres}
            offers={offers}
            selectedCity={selectedCity}
            loading={loadingCatalog}
            onSelectMovie={handleSelectMovie}
            onBookMovie={(movie) => handleBookMovie(movie)}
            onSelectShow={(showId) => handleSelectShow(showId)}
            onOpenTheatres={() => handleOpenPrimaryTab('THEATRES')}
            onSelectTheatre={handleSelectTheatre}
          />
        )}

        {activePrimaryTab === 'THEATRES' && (
          <TheatresPage
            theatres={theatres}
            cities={cities}
            selectedCity={selectedCity}
            initialTheatreId={selectedTheatreId}
            isAuthenticated={Boolean(currentUser)}
            onChangeCity={(city) => setSelectedCity(city)}
            onSelectShow={(showId) => handleSelectShow(showId)}
            onRequireAuth={() => {
              setAuthMode('LOGIN');
              setAuthModalOpen(true);
            }}
            onRefreshTheatres={() => setRefreshSignal((s) => s + 1)}
          />
        )}

        {activePrimaryTab === 'BOOKINGS' && (
          <BookingsPage
            refreshSignal={refreshSignal}
            onBrowseMovies={() => handleOpenPrimaryTab('HOME')}
          />
        )}

        {activePrimaryTab === 'PROFILE' && (
          <ProfilePage
            currentUser={currentUser}
            settings={settings}
            unreadNotifications={unreadNotifications}
            onUserChange={(u) => setCurrentUser(u)}
            onSignOut={handleSignOut}
            onOpenAuthModal={() => {
              setAuthMode('LOGIN');
              setAuthModalOpen(true);
            }}
            onOpenBookings={() => handleOpenPrimaryTab('BOOKINGS')}
            onOpenNotifications={handleOpenNotifications}
            onOpenAdminPanel={openAdminPortal}
          />
        )}
      </div>

      {/* Fixed Bottom Navigation Bar (4 Tabs: Movies, Theatres, Bookings, Profile) */}
      <nav
        aria-label="Bottom Navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe"
      >
        <div className="grid grid-cols-4 h-[58px]">
          {PRIMARY_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activePrimaryTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleOpenPrimaryTab(tab.id)}
                className={`relative flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
                  isActive ? 'text-emerald-700' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {isActive && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-emerald-600 rounded-full" />
                )}
                <Icon className={`w-5 h-5 ${isActive ? 'text-emerald-600' : 'text-slate-500'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Live Search Modal (Movies & Theatres) */}
      {searchOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-start justify-center p-4 pt-12 sm:pt-16">
          <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl border border-slate-200 overflow-hidden max-h-[82vh] flex flex-col">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2.5">
              <Search className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search movies, languages, genres, or theatres..."
                className="flex-1 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none py-1"
              />
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100"
                aria-label="Close search"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto p-4 space-y-5">
              <div>
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                  <Film className="w-3.5 h-3.5" />
                  Movies ({searchResults.movies.length})
                </h3>
                {searchResults.movies.length === 0 ? (
                  <p className="text-xs text-slate-500 py-2">No matching movies found.</p>
                ) : (
                  <div className="space-y-1.5">
                    {searchResults.movies.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setSearchOpen(false);
                          handleSelectMovie(m);
                        }}
                        className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 text-left transition-colors"
                      >
                        <div className="w-10 h-14 rounded-lg overflow-hidden bg-slate-100 shrink-0">
                          <MoviePosterImage
                            src={m.poster_url}
                            alt={m.title}
                            title={m.title}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-display font-semibold text-sm text-slate-950 truncate">
                            {m.title}
                          </div>
                          <div className="text-xs text-slate-500 truncate mt-0.5">
                            {m.certification} · {m.language} · {m.genre} · {formatDuration(m.duration_mins)}
                          </div>
                        </div>
                        <span className="text-xs font-semibold text-emerald-700 shrink-0">
                          {m.availability?.can_book ? 'Book' : 'Details'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" />
                  Theatres ({searchResults.theatres.length})
                </h3>
                {searchResults.theatres.length === 0 ? (
                  <p className="text-xs text-slate-500 py-2">No matching theatres found.</p>
                ) : (
                  <div className="space-y-1.5">
                    {searchResults.theatres.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setSearchOpen(false);
                          handleSelectTheatre(t);
                        }}
                        className="w-full flex items-center justify-between gap-3 p-2.5 rounded-xl hover:bg-slate-50 text-left transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="font-display font-semibold text-sm text-slate-950 truncate">
                            {t.name}
                          </div>
                          <div className="text-xs text-slate-500 truncate mt-0.5">
                            {t.address} · {t.distance_km.toFixed(1)} km
                          </div>
                        </div>
                        <span className="text-xs font-semibold text-emerald-700 shrink-0">Shows</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* City Selector Modal */}
      {cityModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-display font-bold text-base text-slate-950">Select Location</h3>
                <p className="text-xs text-slate-500 mt-0.5">Choose your city to see nearby cinemas</p>
              </div>
              <button
                type="button"
                onClick={() => setCityModalOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 space-y-1">
              {[...cities, 'All Cities'].map((city) => {
                const active = selectedCity === city;
                return (
                  <button
                    key={city}
                    type="button"
                    onClick={() => {
                      setSelectedCity(city);
                      setCityModalOpen(false);
                    }}
                    className={`w-full px-3.5 py-3 rounded-xl text-left flex items-center justify-between text-sm font-medium transition-colors ${
                      active
                        ? 'bg-emerald-50 text-emerald-800 font-semibold'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="inline-flex items-center gap-2.5">
                      <MapPin className={`w-4 h-4 ${active ? 'text-emerald-600' : 'text-slate-400'}`} />
                      {city}
                    </span>
                    {active && <Check className="w-4 h-4 text-emerald-600" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Notifications Drawer */}
      {notificationsOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex justify-end">
          <div className="bg-white w-full max-w-md h-full shadow-2xl border-l border-slate-200 flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-display font-bold text-base text-slate-950">Notifications</h3>
                <p className="text-xs text-slate-500">Offers, booking opens & ticket updates</p>
              </div>
              <button
                type="button"
                onClick={() => setNotificationsOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {notifications.length === 0 ? (
                <div className="p-10 text-center text-sm text-slate-500">
                  You&apos;re all caught up. No notifications yet.
                </div>
              ) : (
                notifications.map((n) => (
                  <div key={n.id} className="px-5 py-4 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                        {n.type.replace(/_/g, ' ')}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {new Date(n.created_at).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                        })}
                      </span>
                    </div>
                    <h4 className="font-display font-semibold text-sm text-slate-950">{n.title}</h4>
                    <p className="text-xs text-slate-600 leading-relaxed">{n.message}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Customer Sign In / Sign Up Modal */}
      {authModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <TicketNowLogo compact />
              <button
                type="button"
                onClick={() => {
                  setAuthModalOpen(false);
                  setAuthError(null);
                }}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('LOGIN');
                    setAuthError(null);
                  }}
                  className={`py-2 rounded-lg text-xs font-semibold transition-colors ${
                    authMode === 'LOGIN' ? 'bg-white text-slate-950 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('REGISTER');
                    setAuthError(null);
                  }}
                  className={`py-2 rounded-lg text-xs font-semibold transition-colors ${
                    authMode === 'REGISTER' ? 'bg-white text-slate-950 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Create Account
                </button>
              </div>

              {authError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
                  {authError}
                </div>
              )}

              <form onSubmit={handleAuthSubmit} className="space-y-3">
                {authMode === 'REGISTER' && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
                      <input
                        type="text"
                        required
                        value={authName}
                        onChange={(e) => setAuthName(e.target.value)}
                        placeholder="e.g. Arjun Sundaram"
                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Mobile Number</label>
                      <input
                        type="tel"
                        required
                        value={authMobile}
                        onChange={(e) => setAuthMobile(e.target.value)}
                        placeholder="+91 98421 00000"
                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-slate-900"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Email Address</label>
                  <input
                    type="email"
                    required
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Password</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-slate-900"
                  />
                </div>

                <button
                  type="submit"
                  disabled={authSubmitting}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
                >
                  {authSubmitting
                    ? 'Please wait...'
                    : authMode === 'LOGIN'
                    ? 'Sign In'
                    : 'Create Account'}
                </button>
              </form>

              {authMode === 'LOGIN' && (
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthEmail('arjun@gmail.com');
                      setAuthPassword('Ticket@123');
                    }}
                    className="text-emerald-700 font-semibold hover:text-emerald-800"
                  >
                    Fill Demo Customer
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthModalOpen(false);
                      openAdminPortal();
                    }}
                    className="text-slate-600 hover:text-slate-950 font-medium"
                  >
                    Super Admin Login →
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
