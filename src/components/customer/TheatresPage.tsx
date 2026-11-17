import { ArrowLeft, Heart, MapPin, Search, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Show, Theatre } from '../../types';
import { apiFetch } from '../../lib/api';
import { formatDateChip, formatINR, getIndicatorMeta } from '../../lib/format';
import { MoviePosterImage } from '../BrandMark';

interface TheatresPageProps {
  theatres: Theatre[];
  cities: string[];
  selectedCity: string;
  initialTheatreId?: string | null;
  isAuthenticated: boolean;
  onChangeCity: (city: string) => void;
  onSelectShow: (showId: string) => void;
  onRequireAuth: () => void;
  onRefreshTheatres: () => void;
}

const FACILITY_FILTERS = ['All', 'Dolby Atmos', '4K RGB Laser', '4K Laser', '3D', 'Parking', 'Cancellable'];

interface TheatreShowsResponse {
  theatre: Theatre;
  dates: string[];
  shows: Array<Show & { certification?: string; duration_mins?: number; genre?: string }>;
}

export function TheatresPage({
  theatres,
  cities,
  selectedCity,
  initialTheatreId,
  isAuthenticated,
  onChangeCity,
  onSelectShow,
  onRequireAuth,
  onRefreshTheatres,
}: TheatresPageProps) {
  const [query, setQuery] = useState('');
  const [facilityFilter, setFacilityFilter] = useState('All');
  const [activeTheatreId, setActiveTheatreId] = useState<string | null>(initialTheatreId || null);
  const [theatreShows, setTheatreShows] = useState<TheatreShowsResponse | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [loadingShows, setLoadingShows] = useState(false);

  useEffect(() => {
    if (initialTheatreId) setActiveTheatreId(initialTheatreId);
  }, [initialTheatreId]);

  useEffect(() => {
    if (!activeTheatreId) {
      setTheatreShows(null);
      return;
    }
    let active = true;
    setLoadingShows(true);
    const params = selectedDate ? `?date=${encodeURIComponent(selectedDate)}` : '';
    apiFetch<TheatreShowsResponse>(`/api/theatres/${activeTheatreId}/shows${params}`)
      .then((res) => {
        if (!active) return;
        setTheatreShows(res);
        if (!selectedDate && res.dates.length > 0) {
          setSelectedDate(res.dates[0]);
        }
      })
      .finally(() => {
        if (active) setLoadingShows(false);
      });
    return () => {
      active = false;
    };
  }, [activeTheatreId, selectedDate]);

  const filteredTheatres = useMemo(() => {
    const q = query.trim().toLowerCase();
    return theatres.filter((t) => {
      if (q && !t.name.toLowerCase().includes(q) && !t.address.toLowerCase().includes(q)) {
        return false;
      }
      if (facilityFilter === 'All') return true;
      if (facilityFilter === 'Cancellable') return t.is_cancellable;
      return t.facilities.some((f) => f.toLowerCase().includes(facilityFilter.toLowerCase()));
    });
  }, [theatres, query, facilityFilter]);

  const toggleFav = async (theatreId: string) => {
    if (!isAuthenticated) {
      onRequireAuth();
      return;
    }
    try {
      await apiFetch(`/api/theatres/${theatreId}/favourite`, { method: 'POST' });
      onRefreshTheatres();
    } catch {
      // ignore
    }
  };

  // Dedicated Theatre Shows View when user clicks "View Shows"
  if (activeTheatreId && theatreShows) {
    const showsByMovie = new Map<
      string,
      { title: string; poster: string; language: string; shows: TheatreShowsResponse['shows'] }
    >();
    for (const s of theatreShows.shows) {
      if (!showsByMovie.has(s.movie_id)) {
        showsByMovie.set(s.movie_id, {
          title: s.movie_title || 'Movie',
          poster: s.movie_poster || '',
          language: s.language,
          shows: [],
        });
      }
      showsByMovie.get(s.movie_id)!.shows.push(s);
    }

    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-4 pb-24 md:pb-12 space-y-5">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => {
              setActiveTheatreId(null);
              setSelectedDate('');
            }}
            className="w-10 h-10 -ml-2 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-800 shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="font-display font-bold text-lg sm:text-xl text-slate-950 leading-snug">
              {theatreShows.theatre.name}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {theatreShows.theatre.address} · {theatreShows.theatre.cancellation_policy}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {theatreShows.theatre.facilities.join(' · ')}
            </p>
          </div>
        </div>

        {/* Date Selector */}
        {theatreShows.dates.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
            {theatreShows.dates.map((d) => {
              const chip = formatDateChip(d);
              const active = selectedDate === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setSelectedDate(d)}
                  className={`flex flex-col items-center min-w-[64px] px-3 py-2 rounded-xl border transition-colors shrink-0 ${
                    active
                      ? 'bg-slate-950 text-white border-slate-950'
                      : 'bg-white text-slate-800 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  <span className={`text-[10px] font-semibold ${active ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {chip.monthShort}
                  </span>
                  <span className="font-display font-bold text-base tabular-nums">{chip.dayNum}</span>
                  <span className="text-[11px]">{chip.weekdayShort}</span>
                </button>
              );
            })}
          </div>
        )}

        {loadingShows ? (
          <div className="py-12 text-center text-sm text-slate-500">Loading active shows...</div>
        ) : showsByMovie.size === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-600">
            No open shows available for this date at this theatre.
          </div>
        ) : (
          <div className="space-y-4">
            {Array.from(showsByMovie.entries()).map(([movieId, group]) => (
              <section key={movieId} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-16 rounded-lg overflow-hidden border border-slate-200 shrink-0 bg-slate-100">
                    <MoviePosterImage
                      src={group.poster}
                      alt={group.title}
                      title={group.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-display font-bold text-base text-slate-950 truncate">{group.title}</h2>
                    <p className="text-xs text-slate-500">{group.language} · {group.shows[0]?.format}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
                  {group.shows.map((show) => {
                    const m = show.metrics;
                    const ind = getIndicatorMeta(m?.indicator || 'AVAILABLE');
                    return (
                      <button
                        key={show.id}
                        type="button"
                        disabled={!m?.booking_open}
                        onClick={() => onSelectShow(show.id)}
                        className={`relative overflow-hidden rounded-xl border bg-white px-2.5 py-2.5 text-center transition-all ${ind.borderClass}`}
                      >
                        <div className="font-mono font-bold text-xs sm:text-sm text-slate-950 tabular-nums">
                          {show.start_time}
                        </div>
                        <div className="text-[10px] text-slate-500 truncate mt-0.5">{show.screen_name}</div>
                        <div className="text-[10px] font-mono text-slate-500 mt-1 tabular-nums">
                          {formatINR(m?.min_price ?? 120)}+
                        </div>
                        <span className={`absolute bottom-0 inset-x-0 h-1 ${ind.barClass}`} />
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-5 pb-24 md:pb-12 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display font-bold text-xl sm:text-2xl text-slate-950 tracking-tight">
            Theatres Near Me
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Discover Dolby Atmos &amp; 4K RGB Laser cinemas in {selectedCity}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-emerald-600 shrink-0" />
          <select
            value={selectedCity}
            onChange={(e) => onChangeCity(e.target.value)}
            aria-label="Filter theatres by city"
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-800 focus:outline-none focus:border-emerald-600 min-h-[42px]"
          >
            <option value="All Cities">All Cities</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Search & Facility Filter Bar */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search cinema name, street, or locality..."
            className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:border-emerald-600"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 pr-1 shrink-0">
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filter:
          </span>
          {FACILITY_FILTERS.map((f) => {
            const active = facilityFilter === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFacilityFilter(f)}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 min-h-[38px] ${
                  active
                    ? 'bg-slate-950 text-white border-slate-950'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                }`}
              >
                {f}
              </button>
            );
          })}
        </div>
      </div>

      {/* Theatre Cards Grid */}
      {theatres.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-10 text-center">
          <p className="font-display font-bold text-base text-slate-900">No Theatres Added Yet</p>
          <p className="text-sm text-slate-500 mt-1">
            Theatres added from the Admin Panel will appear here automatically.
          </p>
        </div>
      ) : filteredTheatres.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-10 text-center">
          <p className="font-display font-semibold text-slate-900">No theatres matched your filter</p>
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setFacilityFilter('All');
            }}
            className="mt-3 px-4 py-2 rounded-lg bg-slate-950 text-white text-xs font-semibold"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredTheatres.map((t) => (
            <article
              key={t.id}
              className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-col justify-between gap-4 hover:border-slate-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="w-12 h-12 rounded-xl bg-slate-950 text-white font-display font-extrabold text-sm flex items-center justify-center shrink-0">
                    {t.logo_code}
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-display font-bold text-base text-slate-950 leading-snug">{t.name}</h2>
                    <p className="text-xs text-slate-500 mt-1">{t.address}</p>
                    <p className="text-xs text-slate-600 mt-1.5">
                      {t.distance_km} km away · {t.screen_count || 1} {(t.screen_count || 1) === 1 ? 'Screen' : 'Screens'} ·{' '}
                      <span className={t.is_cancellable ? 'text-emerald-700 font-medium' : 'text-slate-500'}>
                        {t.cancellation_policy}
                      </span>
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => toggleFav(t.id)}
                  aria-label="Toggle favourite theatre"
                  className="w-10 h-10 rounded-xl hover:bg-slate-100 flex items-center justify-center shrink-0"
                >
                  <Heart className={`w-5 h-5 ${t.is_favourite ? 'fill-rose-500 text-rose-500' : 'text-slate-400'}`} />
                </button>
              </div>

              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-500 truncate max-w-[65%]">
                  {t.facilities.join(' · ')}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDate('');
                    setActiveTheatreId(t.id);
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
                >
                  View Shows ({t.active_show_count || 0})
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
