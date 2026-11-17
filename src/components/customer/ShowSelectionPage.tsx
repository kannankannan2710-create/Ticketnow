import { ArrowLeft, Clock, Heart, Info, Search, Sun, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Movie, MovieBookingAvailability, Show } from '../../types';
import { apiFetch } from '../../lib/api';
import {
  formatDateChip,
  formatDuration,
  formatINR,
  getIndicatorMeta,
  getShowTimeBucket,
  isEarlyMorningShow,
  useCountdown,
} from '../../lib/format';
import { MoviePosterImage } from '../BrandMark';

interface TheatreShowGroup {
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
  shows: Show[];
}

interface MovieShowsPayload {
  movie: Movie;
  availability: MovieBookingAvailability;
  eligible_dates: string[];
  selected_date: string | null;
  announcement: string | null;
  theatres: TheatreShowGroup[];
}

interface ShowSelectionPageProps {
  movieId: string;
  initialDate?: string;
  selectedCity: string;
  isAuthenticated: boolean;
  onBack: () => void;
  onViewMovieDetails: (movie: Movie) => void;
  onSelectShow: (showId: string) => void;
  onRequireAuth: () => void;
}

const TIME_FILTERS: Array<{ id: string; label: string }> = [
  { id: 'ALL', label: 'All Shows' },
  { id: 'MORNING', label: 'Morning' },
  { id: 'AFTERNOON', label: 'Afternoon' },
  { id: 'EVENING', label: 'After 5 PM' },
  { id: 'NIGHT', label: 'Night' },
];

export function ShowSelectionPage({
  movieId,
  initialDate,
  selectedCity,
  isAuthenticated,
  onBack,
  onViewMovieDetails,
  onSelectShow,
  onRequireAuth,
}: ShowSelectionPageProps) {
  const [data, setData] = useState<MovieShowsPayload | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | undefined>(initialDate);
  const [timeFilter, setTimeFilter] = useState('ALL');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadShows = useCallback(
    async (date?: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (selectedCity) params.set('city', selectedCity);
        if (date) params.set('date', date);
        const res = await apiFetch<MovieShowsPayload>(`/api/movies/${movieId}/shows?${params.toString()}`);
        setData(res);
        if (!date && res.selected_date) {
          setSelectedDate(res.selected_date);
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [movieId, selectedCity]
  );

  useEffect(() => {
    loadShows(selectedDate);
  }, [loadShows, selectedDate]);

  const countdown = useCountdown(data?.availability.state === 'SCHEDULED' ? data.availability.opens_at : null);

  const filteredTheatres = useMemo(() => {
    if (!data) return [];
    const q = searchQuery.trim().toLowerCase();
    return data.theatres
      .filter((t) => !q || t.theatre_name.toLowerCase().includes(q) || t.address.toLowerCase().includes(q))
      .map((t) => ({
        ...t,
        shows:
          timeFilter === 'ALL'
            ? t.shows
            : t.shows.filter((s) => getShowTimeBucket(s.start_time) === timeFilter),
      }))
      .filter((t) => t.shows.length > 0);
  }, [data, searchQuery, timeFilter]);

  const toggleFavourite = async (theatreId: string) => {
    if (!isAuthenticated) {
      onRequireAuth();
      return;
    }
    try {
      const res = await apiFetch<{ is_favourite: boolean }>(`/api/theatres/${theatreId}/favourite`, {
        method: 'POST',
      });
      setData((prev) =>
        prev
          ? {
              ...prev,
              theatres: prev.theatres.map((t) =>
                t.theatre_id === theatreId ? { ...t, is_favourite: res.is_favourite } : t
              ),
            }
          : prev
      );
    } catch {
      // ignore
    }
  };

  return (
    <div className="min-h-screen bg-white pb-16">
      {/* 1. CLEAN WHITE TOP HEADER MATCHING REFERENCE */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onBack}
              aria-label="Go back"
              className="w-10 h-10 -ml-2 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-800 shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="font-display font-bold text-base sm:text-lg text-slate-950 truncate leading-tight">
                {data?.movie.title || 'Loading shows...'}
              </h1>
              {data?.movie && (
                <p className="text-xs text-slate-500 mt-0.5 truncate">
                  {data.movie.certification} | {data.movie.language} | {formatDuration(data.movie.duration_mins)}
                </p>
              )}
              {data?.movie && (
                <button
                  type="button"
                  onClick={() => onViewMovieDetails(data.movie)}
                  className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 mt-1"
                >
                  View Details
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setSearchOpen((v) => !v)}
              aria-label="Search theatres"
              className="w-10 h-10 rounded-xl border border-slate-200 hover:bg-slate-50 flex items-center justify-center text-slate-700"
            >
              {searchOpen ? <X className="w-4 h-4" /> : <Search className="w-4 h-4" />}
            </button>
            {data?.movie && (
              <button
                type="button"
                onClick={() => onViewMovieDetails(data.movie)}
                className="w-11 h-14 rounded-lg overflow-hidden border border-slate-200 shrink-0 bg-slate-100"
              >
                <MoviePosterImage
                  src={data.movie.poster_url}
                  alt={data.movie.title}
                  title={data.movie.title}
                  className="w-full h-full object-cover"
                />
              </button>
            )}
          </div>
        </div>

        {/* Inline Theatre Search */}
        {searchOpen && (
          <div className="max-w-5xl mx-auto px-4 sm:px-6 pb-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search theatre or road name..."
                autoFocus
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-emerald-600"
              />
            </div>
          </div>
        )}

        {/* 2. HORIZONTAL ELIGIBLE DATE SELECTOR */}
        {data && data.eligible_dates.length > 0 && (
          <div className="max-w-5xl mx-auto px-4 sm:px-6 pb-3 flex items-center gap-2 overflow-x-auto no-scrollbar">
            {data.eligible_dates.map((dateStr) => {
              const chip = formatDateChip(dateStr);
              const isSelected = (selectedDate || data.selected_date) === dateStr;
              return (
                <button
                  key={dateStr}
                  type="button"
                  onClick={() => setSelectedDate(dateStr)}
                  className={`flex flex-col items-center justify-center min-w-[64px] px-3 py-2 rounded-xl border transition-colors shrink-0 ${
                    isSelected
                      ? 'bg-slate-950 text-white border-slate-950'
                      : 'bg-white text-slate-800 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  <span className={`text-[10px] font-semibold tracking-wide ${isSelected ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {chip.monthShort}
                  </span>
                  <span className="font-display font-bold text-base tabular-nums leading-tight">{chip.dayNum}</span>
                  <span className={`text-[11px] font-medium ${isSelected ? 'text-slate-200' : 'text-slate-500'}`}>
                    {chip.weekdayShort}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-4 space-y-4">
        {/* 3. LIGHT-BLUE ADVANCE BOOKING ANNOUNCEMENT BANNER */}
        {data?.announcement && data.availability.can_book && (
          <div className="rounded-xl bg-sky-50 border border-sky-200/80 px-4 py-3 flex items-center gap-2.5 text-sky-900 text-xs sm:text-sm font-medium">
            <Info className="w-4 h-4 text-sky-600 shrink-0" />
            <span>{data.announcement}</span>
          </div>
        )}

        {/* 4. HORIZONTALLY SCROLLABLE SHOW TIME FILTERS */}
        {data?.availability.can_book && (
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
            {TIME_FILTERS.map((f) => {
              const active = timeFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setTimeFilter(f.id)}
                  className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 min-h-[38px] ${
                    active
                      ? 'bg-slate-950 text-white border-slate-950'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        )}

        {/* 5. COMPACT BOOKING AVAILABILITY LEGEND */}
        {data?.availability.can_book && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-2 px-3 rounded-xl bg-slate-50 border border-slate-200/80 text-[11px] text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <Sun className="w-3.5 h-3.5 text-amber-600" />
              Early morning
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
              Available
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
              Filling fast
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-orange-600" />
              Almost full
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-rose-600" />
              Sold out
            </span>
          </div>
        )}

        {/* Loading / Error / Booking Gate States */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2].map((n) => (
              <div key={n} className="rounded-2xl border border-slate-200 p-5 space-y-4">
                <div className="h-5 w-2/3 bg-slate-100 rounded animate-pulse" />
                <div className="grid grid-cols-3 gap-2.5">
                  {[1, 2, 3, 4, 5, 6].map((k) => (
                    <div key={k} className="h-14 bg-slate-100 rounded-xl animate-pulse" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">{error}</div>
        ) : data && !data.availability.can_book ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center space-y-2">
            <Clock className="w-8 h-8 text-amber-600 mx-auto" />
            <h2 className="font-display font-bold text-lg text-slate-950">{data.availability.label}</h2>
            {data.availability.state === 'SCHEDULED' && data.availability.opens_at && !countdown.expired ? (
              <>
                <p className="text-sm text-slate-600">
                  Ticket sales open strictly on{' '}
                  <strong>{new Date(data.availability.opens_at).toLocaleString('en-IN')}</strong>.
                </p>
                <div className="font-mono text-xl font-bold text-amber-700 tabular-nums pt-1">
                  {countdown.formatted}
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-600">
                No eligible booking window is active for this movie in {selectedCity}.
              </p>
            )}
          </div>
        ) : filteredTheatres.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center">
            <p className="font-display font-semibold text-slate-900">No shows match this filter</p>
            <p className="text-sm text-slate-500 mt-1">Try switching time slot filters or another eligible date.</p>
            <button
              type="button"
              onClick={() => {
                setTimeFilter('ALL');
                setSearchQuery('');
              }}
              className="mt-4 px-4 py-2 rounded-lg bg-slate-950 text-white text-xs font-semibold"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          /* 6. VERTICAL THEATRE CARDS WITH 3-COLUMN SHOWTIME GRID */
          <div className="space-y-4">
            {filteredTheatres.map((theatre) => (
              <section
                key={theatre.theatre_id}
                className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-slate-950 text-white font-display font-bold text-xs flex items-center justify-center shrink-0">
                      {theatre.logo_code}
                    </div>
                    <div className="min-w-0">
                      <h2 className="font-display font-bold text-[15px] sm:text-base text-slate-950 leading-snug">
                        {theatre.theatre_name}
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {theatre.distance_km} km away | {theatre.cancellation_policy}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5 truncate">{theatre.address}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    aria-label={theatre.is_favourite ? 'Remove from favourites' : 'Add to favourites'}
                    onClick={() => toggleFavourite(theatre.theatre_id)}
                    className="w-10 h-10 rounded-xl hover:bg-slate-100 flex items-center justify-center shrink-0"
                  >
                    <Heart
                      className={`w-5 h-5 transition-colors ${
                        theatre.is_favourite ? 'fill-rose-500 text-rose-500' : 'text-slate-400'
                      }`}
                    />
                  </button>
                </div>

                {/* 7. RESPONSIVE THREE-COLUMN SHOWTIME BUTTON GRID */}
                <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
                  {theatre.shows.map((show) => {
                    const m = show.metrics;
                    const ind = getIndicatorMeta(m?.indicator || 'AVAILABLE');
                    const disabled = !m?.booking_open;
                    const early = isEarlyMorningShow(show.start_time);

                    return (
                      <button
                        key={show.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => onSelectShow(show.id)}
                        title={`${ind.label} · ${m?.available_seats ?? 0} seats available · Starting ${formatINR(m?.min_price ?? 120)}`}
                        className={`relative overflow-hidden rounded-xl border bg-white px-2.5 py-2.5 text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${ind.borderClass}`}
                      >
                        <div className="flex items-center justify-center gap-1 font-mono font-bold text-[13px] sm:text-sm text-slate-950 tabular-nums whitespace-nowrap">
                          {early && <Sun className="w-3 h-3 text-amber-500 shrink-0" />}
                          {show.start_time}
                        </div>
                        <div className="text-[10px] font-medium text-slate-500 truncate mt-0.5">
                          {show.screen_name || `SCREEN ${show.screen_number}`}
                        </div>
                        <div className="flex items-center justify-between text-[10px] mt-1 pt-1 border-t border-slate-100 px-0.5">
                          <span className={`font-semibold ${ind.textClass} tabular-nums`}>
                            {m?.available_seats ?? 0} left
                          </span>
                          <span className="font-mono text-slate-500 tabular-nums">
                            {formatINR(m?.min_price ?? 120)}+
                          </span>
                        </div>
                        <span className={`absolute bottom-0 inset-x-0 h-1 ${ind.barClass}`} aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
