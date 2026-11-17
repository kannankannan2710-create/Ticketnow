import { ArrowLeft, Calendar, Clock, Film, Star, Users } from 'lucide-react';
import type { Movie } from '../../types';
import { formatDateChip, formatDuration, formatINR, useCountdown } from '../../lib/format';
import { MoviePosterImage } from '../BrandMark';

interface MovieDetailsPageProps {
  movie: Movie;
  onBack: () => void;
  onBookTickets: (movie: Movie, preferredDate?: string) => void;
}

export function MovieDetailsPage({ movie, onBack, onBookTickets }: MovieDetailsPageProps) {
  const avail = movie.availability;
  const countdown = useCountdown(avail?.state === 'SCHEDULED' ? avail.opens_at : null);
  const releaseChip = formatDateChip(movie.release_date);

  return (
    <div className="min-h-screen bg-white pb-28 md:pb-12">
      {/* Compact Sticky Top Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 text-slate-800 hover:text-slate-950 font-medium text-sm min-h-[44px] -ml-1 px-1"
          >
            <ArrowLeft className="w-5 h-5 shrink-0" />
            <span className="truncate max-w-[240px] sm:max-w-md font-display font-bold">{movie.title}</span>
          </button>
          <span className="text-xs font-medium text-slate-500 whitespace-nowrap shrink-0">
            {movie.certification} · {movie.language}
          </span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 space-y-8">
        {/* Hero Split */}
        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6 sm:gap-8 items-start">
          <div className="w-56 sm:w-64 md:w-full mx-auto md:mx-0 rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-slate-100 aspect-[3/4]">
            <MoviePosterImage
              src={movie.poster_url}
              alt={`${movie.title} poster`}
              title={movie.title}
              className="w-full h-full object-cover"
            />
          </div>

          <div className="space-y-5">
            <div>
              <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-slate-950 tracking-tight text-balance">
                {movie.title}
              </h1>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-slate-600 mt-2">
                <span className="font-semibold text-slate-900">{movie.certification}</span>
                <span aria-hidden="true">·</span>
                <span>{movie.language}</span>
                <span aria-hidden="true">·</span>
                <span>{formatDuration(movie.duration_mins)}</span>
                <span aria-hidden="true">·</span>
                <span>{movie.genre}</span>
              </div>

              <div className="flex flex-wrap items-center gap-5 mt-3 text-sm">
                {movie.rating !== null && (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 tabular-nums">
                    <Star className="w-4 h-4 fill-emerald-600 text-emerald-600" />
                    {movie.rating.toFixed(1)} / 10 Audience Rating
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 text-slate-600">
                  <Calendar className="w-4 h-4 text-slate-400" />
                  Released {releaseChip.fullLabel}
                </span>
                {avail?.min_price ? (
                  <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                    Tickets from {formatINR(avail.min_price)}
                  </span>
                ) : null}
              </div>
            </div>

            {/* Booking Status Banner / Countdown */}
            {avail?.state === 'SCHEDULED' && avail.opens_at && !countdown.expired ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
                  <Clock className="w-4 h-4 text-amber-700" />
                  Advance Booking Scheduled
                </div>
                <p className="text-sm text-amber-950">
                  Bookings automatically open on{' '}
                  <strong className="font-mono">
                    {new Date(avail.opens_at).toLocaleString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </strong>
                </p>
                <div className="font-mono text-lg font-bold text-amber-900 tabular-nums pt-0.5">
                  Starts in {countdown.formatted}
                </div>
              </div>
            ) : avail?.state === 'CLOSED' ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                Booking is currently closed by theatre administration.
              </div>
            ) : avail?.can_book ? (
              <div className="space-y-3">
                <div className="text-xs font-semibold text-slate-500">Available Booking Dates</div>
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                  {avail.eligible_dates.map((d) => {
                    const chip = formatDateChip(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => onBookTickets(movie, d)}
                        className="flex flex-col items-center justify-center min-w-[68px] py-2 px-3 rounded-xl border border-slate-200 hover:border-emerald-600 hover:bg-emerald-50/50 transition-colors shrink-0"
                      >
                        <span className="text-[11px] font-medium text-slate-500">{chip.weekdayShort}</span>
                        <span className="font-display font-bold text-base text-slate-950 tabular-nums leading-tight">
                          {chip.dayNum}
                        </span>
                        <span className="text-[10px] font-semibold text-slate-500">{chip.monthShort}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="hidden md:block pt-2">
                  <button
                    type="button"
                    onClick={() => onBookTickets(movie)}
                    className="px-7 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-display font-bold text-sm transition-colors"
                  >
                    Book Tickets · {avail.active_show_count} Active Shows
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                Shows have not been scheduled yet. Check back soon for release showtimes.
              </div>
            )}

            {/* About the Movie */}
            <div className="pt-2 border-t border-slate-100">
              <h2 className="font-display font-bold text-base text-slate-950 mb-2">About the Movie</h2>
              <p className="text-sm sm:text-[15px] text-slate-600 leading-relaxed">{movie.description}</p>
            </div>
          </div>
        </div>

        {/* Cast & Crew */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-100">
          {movie.cast.length > 0 && (
            <section>
              <h2 className="font-display font-bold text-base text-slate-950 flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-emerald-600" />
                Cast
              </h2>
              <div className="grid grid-cols-2 gap-3">
                {movie.cast.map((c, idx) => (
                  <div key={`${c.name}-${idx}`} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-white">
                    <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-700 font-display font-bold text-xs flex items-center justify-center shrink-0">
                      {c.name
                        .split(' ')
                        .map((p) => p[0])
                        .join('')
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-950 truncate">{c.name}</div>
                      <div className="text-xs text-slate-500 truncate">{c.role}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {movie.crew.length > 0 && (
            <section>
              <h2 className="font-display font-bold text-base text-slate-950 flex items-center gap-2 mb-3">
                <Film className="w-4 h-4 text-emerald-600" />
                Crew
              </h2>
              <div className="grid grid-cols-2 gap-3">
                {movie.crew.map((c, idx) => (
                  <div key={`${c.name}-${idx}`} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-white">
                    <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-800 font-display font-bold text-xs flex items-center justify-center shrink-0">
                      {c.name
                        .split(' ')
                        .map((p) => p[0])
                        .join('')
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-950 truncate">{c.name}</div>
                      <div className="text-xs text-slate-500 truncate">{c.role}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>

      {/* Fixed Mobile Bottom Book CTA (Only when booking is genuinely OPEN!) */}
      {avail?.can_book && (
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 p-3.5 pb-safe">
          <button
            type="button"
            onClick={() => onBookTickets(movie)}
            className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-display font-bold text-sm transition-colors"
          >
            Book Tickets {avail.min_price ? `· From ${formatINR(avail.min_price)}` : ''}
          </button>
        </div>
      )}
    </div>
  );
}
