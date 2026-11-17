import { Calendar, ChevronLeft, ChevronRight, Clock, MapPin, Star, Tag } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Movie, Offer, Theatre } from '../../types';
import { formatDateChip, formatINR, getIndicatorMeta, useCountdown } from '../../lib/format';
import { CinemaProjectorIllustration, FilmReelIllustration, MoviePosterImage } from '../BrandMark';

interface HomePageProps {
  nowShowing: Movie[];
  upcoming: Movie[];
  theatres: Theatre[];
  offers: Offer[];
  selectedCity: string;
  loading: boolean;
  onSelectMovie: (movie: Movie) => void;
  onBookMovie: (movie: Movie) => void;
  onSelectShow: (showId: string) => void;
  onOpenTheatres: () => void;
  onSelectTheatre: (theatre: Theatre) => void;
}

const FILTER_OPTIONS = [
  'All',
  'Top Selling',
  'Tamil',
  'Telugu',
  'Malayalam',
  'Hindi',
  'Action',
  'Thriller',
  'Comedy',
  'Romance',
];

function ScheduledCountdownLine({ opensAt }: { opensAt: string }) {
  const cd = useCountdown(opensAt);
  if (cd.expired) {
    return <span className="text-xs font-semibold text-emerald-700">Booking Open Now</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 font-mono tabular-nums">
      <Clock className="w-3.5 h-3.5 shrink-0" />
      Opens in {cd.formatted}
    </span>
  );
}

export function HomePage({
  nowShowing,
  upcoming,
  theatres,
  offers,
  selectedCity,
  loading,
  onSelectMovie,
  onBookMovie,
  onSelectShow,
  onOpenTheatres,
  onSelectTheatre,
}: HomePageProps) {
  const [activeFilter, setActiveFilter] = useState('All');
  const [bannerIndex, setBannerIndex] = useState(0);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const nowShowingRef = useRef<HTMLElement | null>(null);
  const upcomingRef = useRef<HTMLElement | null>(null);
  const touchStartX = useRef<number | null>(null);

  // Auto-slide promotional banner carousel
  useEffect(() => {
    if (offers.length <= 1) return;
    const id = setInterval(() => {
      setBannerIndex((prev) => (prev + 1) % offers.length);
    }, 5500);
    return () => clearInterval(id);
  }, [offers.length]);

  const safeBannerIdx = offers.length > 0 ? bannerIndex % offers.length : 0;

  const filteredNowShowing = useMemo(() => {
    if (activeFilter === 'All') return nowShowing;
    if (activeFilter === 'Top Selling') return nowShowing.filter((m) => m.is_top_selling);
    return nowShowing.filter(
      (m) =>
        m.language.toLowerCase().includes(activeFilter.toLowerCase()) ||
        m.genre.toLowerCase().includes(activeFilter.toLowerCase())
    );
  }, [nowShowing, activeFilter]);

  const handleCopyCoupon = (code: string) => {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const scrollToSecondarySection = () => {
    if (upcoming.length > 0 && upcomingRef.current) {
      upcomingRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      nowShowingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-4 pb-24 md:pb-12 space-y-8">
      {/* 1. TWO LARGE HORIZONTAL FEATURED SHORTCUT CARDS */}
      <section aria-label="Quick discovery shortcuts">
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <button
            type="button"
            onClick={onOpenTheatres}
            className="group flex items-center justify-between gap-3 p-4 sm:p-5 rounded-2xl bg-slate-50 hover:bg-emerald-50/60 border border-slate-200 hover:border-emerald-300 text-left transition-colors min-h-[86px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
          >
            <div className="min-w-0">
              <div className="font-display font-bold text-[15px] sm:text-base text-slate-950 leading-snug">
                Theatres near me
              </div>
              <p className="text-xs text-slate-500 mt-0.5 truncate">
                {theatres.length} {theatres.length === 1 ? 'cinema' : 'cinemas'} in {selectedCity}
              </p>
            </div>
            <div className="shrink-0 transition-transform duration-200 group-hover:scale-105">
              <CinemaProjectorIllustration />
            </div>
          </button>

          <button
            type="button"
            onClick={scrollToSecondarySection}
            className="group flex items-center justify-between gap-3 p-4 sm:p-5 rounded-2xl bg-slate-50 hover:bg-emerald-50/60 border border-slate-200 hover:border-emerald-300 text-left transition-colors min-h-[86px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
          >
            <div className="min-w-0">
              <div className="font-display font-bold text-[15px] sm:text-base text-slate-950 leading-snug">
                {upcoming.length > 0 ? 'Upcoming movies' : 'Now showing'}
              </div>
              <p className="text-xs text-slate-500 mt-0.5 truncate">
                {upcoming.length > 0
                  ? `${upcoming.length} scheduled releases`
                  : `${nowShowing.length} active ${nowShowing.length === 1 ? 'movie' : 'movies'} in ${selectedCity}`}
              </p>
            </div>
            <div className="shrink-0 transition-transform duration-200 group-hover:scale-105">
              <FilmReelIllustration />
            </div>
          </button>
        </div>
      </section>

      {/* 2. PROMOTIONAL BANNER CAROUSEL (SWIPEABLE + AUTO-SLIDE + LIVE FROM ADMIN DB) */}
      {offers.length > 0 && (
        <section aria-label="Promotional offers">
          <div
            className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-950"
            onTouchStart={(e) => {
              touchStartX.current = e.touches[0].clientX;
            }}
            onTouchEnd={(e) => {
              if (touchStartX.current === null) return;
              const delta = e.changedTouches[0].clientX - touchStartX.current;
              touchStartX.current = null;
              if (Math.abs(delta) > 40) {
                setBannerIndex((prev) =>
                  delta < 0 ? (prev + 1) % offers.length : (prev - 1 + offers.length) % offers.length
                );
              }
            }}
          >
            {(() => {
              const offer = offers[safeBannerIdx];
              const discountText =
                offer.discount_type === 'PERCENT'
                  ? `${offer.discount_value}% OFF · Up to ${formatINR(offer.max_discount)}`
                  : `Flat ${formatINR(offer.discount_value)} OFF`;
              return (
                <div className="relative min-h-[196px] sm:min-h-[230px] flex items-end">
                  <img
                    src={offer.banner_url}
                    alt={offer.title}
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/65 to-slate-950/25" />

                  <div className="relative z-10 w-full p-5 sm:p-7 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                    <div className="max-w-xl">
                      <div className="text-xs font-semibold tracking-wide text-emerald-400">
                        {offer.subtitle} · {discountText}
                      </div>
                      <h2 className="font-display font-bold text-xl sm:text-2xl text-white mt-1 leading-tight text-balance">
                        {offer.title}
                      </h2>
                      <p className="text-xs sm:text-sm text-slate-200 mt-1.5 line-clamp-2 max-w-lg">
                        {offer.description}
                      </p>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopyCoupon(offer.coupon_code)}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[44px]"
                      >
                        <Tag className="w-4 h-4 shrink-0" />
                        {copiedCode === offer.coupon_code ? `Copied ${offer.coupon_code}` : offer.cta_label}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {offers.length > 1 && (
              <>
                <button
                  type="button"
                  aria-label="Previous offer"
                  onClick={() => setBannerIndex((prev) => (prev - 1 + offers.length) % offers.length)}
                  className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/45 hover:bg-black/70 text-white items-center justify-center transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  aria-label="Next offer"
                  onClick={() => setBannerIndex((prev) => (prev + 1) % offers.length)}
                  className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/45 hover:bg-black/70 text-white items-center justify-center transition-colors"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5">
                  {offers.map((o, idx) => (
                    <button
                      key={o.id}
                      type="button"
                      aria-label={`View slide ${idx + 1}`}
                      onClick={() => setBannerIndex(idx)}
                      className={`h-1.5 rounded-full transition-all ${
                        idx === safeBannerIdx ? 'w-6 bg-emerald-400' : 'w-1.5 bg-white/50'
                      }`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {/* 3. NOW SHOWING SECTION — LIVE DATABASE-DRIVEN MOVIES FOR SELECTED CITY */}
      <section ref={nowShowingRef} aria-labelledby="now-showing-heading" className="space-y-4 scroll-mt-20">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="now-showing-heading" className="font-display font-bold text-lg sm:text-xl tracking-tight text-slate-950">
            Now Showing
          </h2>
          <span className="text-xs text-slate-500 tabular-nums">
            {filteredNowShowing.length} {filteredNowShowing.length === 1 ? 'movie' : 'movies'} in {selectedCity}
          </span>
        </div>

        {/* Horizontally scrollable filter buttons (only shown when movies are actively playing) */}
        {nowShowing.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">
            {FILTER_OPTIONS.map((filter) => {
              const active = activeFilter === filter;
              return (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setActiveFilter(filter)}
                  className={`px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 min-h-[40px] border ${
                    active
                      ? 'bg-slate-950 text-white border-slate-950'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400 hover:text-slate-950'
                  }`}
                >
                  {filter}
                </button>
              );
            })}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
                <div className="aspect-[3/4] bg-slate-100 animate-pulse" />
                <div className="p-3.5 space-y-2">
                  <div className="h-4 bg-slate-100 rounded w-3/4 animate-pulse" />
                  <div className="h-3 bg-slate-100 rounded w-1/2 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : nowShowing.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-10 text-center">
            <p className="font-display font-bold text-base sm:text-lg text-slate-900">
              No Movies Available Right Now
            </p>
            <p className="text-sm text-slate-500 mt-1.5 max-w-md mx-auto">
              There are currently no active shows scheduled in {selectedCity}. Movies automatically appear here as soon as shows are scheduled.
            </p>
          </div>
        ) : filteredNowShowing.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center">
            <p className="font-display font-semibold text-slate-900">No movies match “{activeFilter}”</p>
            <p className="text-sm text-slate-500 mt-1">Try another language or genre filter to see active shows.</p>
            <button
              type="button"
              onClick={() => setActiveFilter('All')}
              className="mt-4 px-4 py-2 rounded-lg bg-slate-950 text-white text-xs font-semibold"
            >
              Show All Movies
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
            {filteredNowShowing.map((movie) => {
              const avail = movie.availability;
              const summary = avail?.schedule_summary;
              const formats = summary?.formats || [];
              const theatreNames = summary?.theatre_names || [];
              const dates = summary?.dates || avail?.eligible_dates || [];
              const firstDate = dates[0];
              const openTimings = summary?.timings || [];
              const firstDateTimings = firstDate
                ? openTimings.filter((t) => t.show_date === firstDate)
                : openTimings;
              const visibleTimings = firstDateTimings.slice(0, 4);
              const extraTimingsCount = Math.max(0, openTimings.length - visibleTimings.length);

              return (
                <article
                  key={movie.id}
                  className="group rounded-2xl border border-slate-200 bg-white overflow-hidden flex flex-col transition-shadow hover:shadow-md"
                >
                  <button
                    type="button"
                    onClick={() => onSelectMovie(movie)}
                    className="text-left flex flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600"
                  >
                    <div className="relative aspect-[3/4] w-full overflow-hidden bg-slate-100">
                      <MoviePosterImage
                        src={movie.poster_url}
                        alt={`${movie.title} poster`}
                        title={movie.title}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 pb-2.5 pt-8 flex items-center justify-between text-white text-xs">
                        {movie.rating !== null ? (
                          <span className="inline-flex items-center gap-1 font-semibold tabular-nums">
                            <Star className="w-3.5 h-3.5 fill-emerald-400 text-emerald-400" />
                            {movie.rating.toFixed(1)}/10
                          </span>
                        ) : (
                          <span className="font-semibold text-emerald-300">
                            {formats.length > 0 ? formats.slice(0, 2).join(' · ') : movie.certification}
                          </span>
                        )}
                        {avail?.min_price ? (
                          <span className="font-mono text-[11px] text-slate-100 tabular-nums">
                            From {formatINR(avail.min_price)}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="px-3.5 pt-3.5 pb-2">
                      <h3 className="font-display font-bold text-[15px] text-slate-950 leading-snug line-clamp-1">
                        {movie.title}
                      </h3>
                      <p className="text-xs text-slate-600 mt-1 line-clamp-1">
                        {movie.language}
                        {formats.length > 0 ? ` · ${formats.join(', ')}` : ''} · {movie.certification}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">{movie.genre}</p>
                    </div>
                  </button>

                  {/* Live Database Show Schedule Details (Theatres, Dates, Available Timings) */}
                  <div className="px-3.5 pb-3.5 pt-1 flex-1 flex flex-col justify-between gap-3">
                    <div className="space-y-2 border-t border-slate-100 pt-2.5">
                      {/* Available Theatres */}
                      {theatreNames.length > 0 && (
                        <div className="flex items-start gap-1.5 text-[11px] text-slate-600">
                          <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                          <span className="line-clamp-2 leading-snug">
                            {theatreNames.slice(0, 2).join(', ')}
                            {theatreNames.length > 2 ? ` +${theatreNames.length - 2} more` : ''}
                          </span>
                        </div>
                      )}

                      {/* Available Show Dates */}
                      {dates.length > 0 && (
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                          <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate font-medium">
                            {dates
                              .slice(0, 3)
                              .map((d) => {
                                const c = formatDateChip(d);
                                return `${c.dayNum} ${c.monthShort}`;
                              })
                              .join(' · ')}
                            {dates.length > 3 ? ` +${dates.length - 3}` : ''}
                          </span>
                        </div>
                      )}

                      {/* Available Show Timings (Direct 1-click booking, unavailable showtimes hidden) */}
                      {visibleTimings.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          {visibleTimings.map((slot) => {
                            const ind = getIndicatorMeta(slot.indicator);
                            return (
                              <button
                                key={slot.show_id}
                                type="button"
                                onClick={() => onSelectShow(slot.show_id)}
                                title={`${slot.theatre_name} · ${slot.screen_name} · ${slot.available_seats} seats left`}
                                className={`px-2 py-1 rounded-md border bg-white text-[11px] font-mono font-semibold text-slate-900 tabular-nums transition-colors ${ind.borderClass}`}
                              >
                                {slot.start_time}
                              </button>
                            );
                          })}
                          {extraTimingsCount > 0 && (
                            <button
                              type="button"
                              onClick={() => onBookMovie(movie)}
                              className="px-2 py-1 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 text-[11px] font-semibold text-slate-600"
                            >
                              +{extraTimingsCount} more
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {avail?.can_book ? (
                      <button
                        type="button"
                        onClick={() => onBookMovie(movie)}
                        className="w-full py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors min-h-[40px]"
                      >
                        Book Now
                      </button>
                    ) : avail?.state === 'SCHEDULED' && avail.opens_at ? (
                      <div className="py-2 text-center border-t border-slate-100">
                        <ScheduledCountdownLine opensAt={avail.opens_at} />
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* 4. THEATRES NEAR ME PREVIEW STRIP (SHOWN WHEN ACTIVE THEATRES EXIST IN SELECTED CITY) */}
      {theatres.length > 0 && (
        <section aria-labelledby="theatres-near-heading" className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h2 id="theatres-near-heading" className="font-display font-bold text-lg sm:text-xl tracking-tight text-slate-950">
              Theatres Near Me
            </h2>
            <button
              type="button"
              onClick={onOpenTheatres}
              className="text-xs sm:text-sm font-semibold text-emerald-700 hover:text-emerald-800 whitespace-nowrap shrink-0 min-h-[40px] px-1"
            >
              View all
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {theatres.slice(0, 4).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelectTheatre(t)}
                className="text-left p-4 rounded-2xl border border-slate-200 bg-white hover:border-emerald-300 hover:shadow-sm transition-all flex flex-col justify-between gap-3"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-950 text-white font-display font-bold text-xs flex items-center justify-center shrink-0">
                    {t.logo_code}
                  </div>
                  <div className="min-w-0">
                    <div className="font-display font-bold text-sm text-slate-950 line-clamp-2 leading-snug">
                      {t.name}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-slate-500 mt-1">
                      <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                      <span className="truncate">{t.distance_km} km · {t.city}</span>
                    </div>
                  </div>
                </div>
                <div className="text-xs text-slate-500 border-t border-slate-100 pt-2.5 truncate">
                  {t.facilities.slice(0, 3).join(' · ')}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 5. UPCOMING MOVIES — ONLY DISPLAYED WHEN SCHEDULED MOVIES EXIST IN SELECTED CITY */}
      {upcoming.length > 0 && (
        <section ref={upcomingRef} aria-labelledby="upcoming-heading" className="space-y-4 scroll-mt-20">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="upcoming-heading" className="font-display font-bold text-lg sm:text-xl tracking-tight text-slate-950">
              Upcoming Movies
            </h2>
            <span className="text-xs text-slate-500">Booking opens soon in {selectedCity}</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5 sm:gap-5">
            {upcoming.map((movie) => {
              const rel = formatDateChip(movie.release_date);
              const avail = movie.availability;
              return (
                <article
                  key={movie.id}
                  className="group rounded-2xl border border-slate-200 bg-white overflow-hidden flex flex-col hover:shadow-md transition-shadow"
                >
                  <button
                    type="button"
                    onClick={() => onSelectMovie(movie)}
                    className="text-left flex-1 flex flex-col"
                  >
                    <div className="relative aspect-[3/4] w-full overflow-hidden bg-slate-100">
                      <MoviePosterImage
                        src={movie.poster_url}
                        alt={`${movie.title} poster`}
                        title={movie.title}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent px-3 pb-2.5 pt-8 text-white text-xs font-medium">
                        Releases {rel.fullLabel}
                      </div>
                    </div>

                    <div className="p-3 sm:p-3.5 flex-1 flex flex-col">
                      <h3 className="font-display font-bold text-[14px] sm:text-[15px] text-slate-950 leading-snug line-clamp-1">
                        {movie.title}
                      </h3>
                      <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                        {movie.certification} · {movie.language}
                      </p>
                      <div className="mt-2">
                        {avail?.state === 'SCHEDULED' && avail.opens_at ? (
                          <ScheduledCountdownLine opensAt={avail.opens_at} />
                        ) : (
                          <span className="text-xs font-medium text-slate-500">Booking Opens Soon</span>
                        )}
                      </div>
                    </div>
                  </button>

                  <div className="px-3 sm:px-3.5 pb-3 sm:pb-3.5">
                    <button
                      type="button"
                      onClick={() => onSelectMovie(movie)}
                      className="w-full py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-semibold transition-colors min-h-[40px]"
                    >
                      View Details
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
