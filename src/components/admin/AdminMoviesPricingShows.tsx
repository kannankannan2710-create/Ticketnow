import { Calendar, Copy, Pencil, Plus, Table, Trash2, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { formatINR, getIndicatorMeta } from '../../lib/format';
import type { Movie, MoviePricingRule, MovieStatus, Screen, Show, Theatre } from '../../types';
import { MoviePosterImage } from '../BrandMark';

export function AdminMoviesModule({ onDataChanged }: { onDataChanged: () => void }) {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Movie | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [form, setForm] = useState({
    title: '',
    language: 'Tamil',
    genre: 'Action, Thriller',
    certification: 'U/A',
    duration_mins: 150,
    release_date: new Date().toISOString().slice(0, 10),
    poster_url: '',
    banner_url: '',
    trailer_url: '',
    description: '',
    castText: '',
    crewText: '',
    rating: '',
    is_top_selling: false,
    status: 'NOW_SHOWING' as MovieStatus,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ movies: Movie[] }>('/api/admin/movies');
      setMovies(res.movies);
    } catch (err) {
      setMsg({ type: 'err', text: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      title: '',
      language: 'Tamil',
      genre: 'Action, Thriller',
      certification: 'U/A',
      duration_mins: 150,
      release_date: new Date().toISOString().slice(0, 10),
      poster_url: '',
      banner_url: '',
      trailer_url: '',
      description: '',
      castText: '',
      crewText: '',
      rating: '',
      is_top_selling: false,
      status: 'NOW_SHOWING',
    });
    setModalOpen(true);
  };

  const openEdit = (m: Movie) => {
    setEditing(m);
    setForm({
      title: m.title,
      language: m.language,
      genre: m.genre,
      certification: m.certification,
      duration_mins: m.duration_mins,
      release_date: m.release_date,
      poster_url: m.poster_url,
      banner_url: m.banner_url || '',
      trailer_url: m.trailer_url || '',
      description: m.description,
      castText: m.cast.map((c) => `${c.name} - ${c.role}`).join('\n'),
      crewText: m.crew.map((c) => `${c.name} - ${c.role}`).join('\n'),
      rating: m.rating !== null ? String(m.rating) : '',
      is_top_selling: m.is_top_selling,
      status: m.status,
    });
    setModalOpen(true);
  };

  const parseMembers = (txt: string) =>
    txt
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, role] = line.split('-').map((p) => p.trim());
        return { name: name || line, role: role || 'Cast' };
      });

  const handleFileUpload = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setForm((prev) => ({ ...prev, poster_url: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const payload = {
      title: form.title,
      language: form.language,
      genre: form.genre,
      certification: form.certification,
      duration_mins: Number(form.duration_mins),
      release_date: form.release_date,
      poster_url: form.poster_url,
      banner_url: form.banner_url || null,
      trailer_url: form.trailer_url || null,
      description: form.description,
      cast: parseMembers(form.castText),
      crew: parseMembers(form.crewText),
      rating: form.rating ? Number(form.rating) : null,
      is_top_selling: form.is_top_selling,
      status: form.status,
    };

    try {
      if (editing) {
        await apiFetch(`/api/admin/movies/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        setMsg({ type: 'ok', text: `Updated ${form.title}.` });
      } else {
        await apiFetch('/api/admin/movies', { method: 'POST', body: JSON.stringify(payload) });
        setMsg({ type: 'ok', text: `Added movie ${form.title}.` });
      }
      setModalOpen(false);
      await load();
      onDataChanged();
    } catch (err) {
      setMsg({ type: 'err', text: (err as Error).message });
    }
  };

  const handleDelete = async (m: Movie) => {
    try {
      await apiFetch(`/api/admin/movies/${m.id}`, { method: 'DELETE' });
      setMsg({ type: 'ok', text: `Deleted ${m.title}.` });
      await load();
      onDataChanged();
    } catch (err) {
      setMsg({ type: 'err', text: (err as Error).message });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-lg text-slate-950">Movie Management</h2>
          <p className="text-xs text-slate-500">Upload posters, manage Now Showing / Upcoming status &amp; cast metadata</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
        >
          <Plus className="w-4 h-4" />
          Add Movie
        </button>
      </div>

      {msg && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-xs font-medium ${
            msg.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-3 px-4 font-semibold">Movie</th>
                <th className="py-3 px-4 font-semibold">Details</th>
                <th className="py-3 px-4 font-semibold">Release Date</th>
                <th className="py-3 px-4 font-semibold">Booking State</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    Loading movies...
                  </td>
                </tr>
              ) : movies.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 px-4 text-center">
                    <p className="font-display font-bold text-sm text-slate-900">No Movies Added Yet</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Add your first movie with poster, language, genre, and release details.
                    </p>
                    <button
                      type="button"
                      onClick={openCreate}
                      className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                    >
                      <Plus className="w-4 h-4" />
                      Add Movie
                    </button>
                  </td>
                </tr>
              ) : (
                movies.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-14 rounded-lg overflow-hidden border border-slate-200 shrink-0 bg-slate-100">
                          <MoviePosterImage src={m.poster_url} alt={m.title} title={m.title} className="w-full h-full object-cover" />
                        </div>
                        <div>
                          <div className="font-semibold text-slate-950">{m.title}</div>
                          <div className="text-[11px] text-slate-500">
                            {m.is_top_selling ? 'Top Selling · ' : ''}
                            {m.rating ? `★ ${m.rating}` : 'Unrated'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {m.certification} · {m.language} · {m.duration_mins}m
                      <div className="text-[11px] text-slate-400">{m.genre}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-700">{m.release_date}</td>
                    <td className="py-3 px-4 text-slate-700">
                      <div className="font-semibold">{m.availability?.label || '—'}</div>
                      <div className="text-[11px] text-slate-400">
                        {m.availability?.active_show_count || 0} active shows
                      </div>
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-900">{m.status}</td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openEdit(m)}
                        className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-700 mr-1"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(m)}
                        className="p-1.5 rounded-lg hover:bg-rose-100 text-rose-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleSave}
            className="bg-white w-full max-w-2xl rounded-2xl border border-slate-200 shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white">
              <h3 className="font-display font-bold text-base text-slate-950">
                {editing ? 'Edit Movie' : 'Add Movie'}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Movie Title</label>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Language</label>
                <select
                  value={form.language}
                  onChange={(e) => setForm({ ...form, language: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white"
                >
                  {['Tamil', 'Telugu', 'Malayalam', 'Hindi', 'Kannada', 'English'].map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Genre</label>
                <input
                  type="text"
                  required
                  value={form.genre}
                  onChange={(e) => setForm({ ...form, genre: e.target.value })}
                  placeholder="Action, Thriller"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Certification</label>
                <select
                  value={form.certification}
                  onChange={(e) => setForm({ ...form, certification: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white"
                >
                  {['U', 'U/A', 'UA13+', 'UA16+', 'A'].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Duration (mins)</label>
                <input
                  type="number"
                  min={60}
                  value={form.duration_mins}
                  onChange={(e) => setForm({ ...form, duration_mins: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Release Date</label>
                <input
                  type="date"
                  value={form.release_date}
                  onChange={(e) => setForm({ ...form, release_date: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Movie Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as MovieStatus })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white"
                >
                  <option value="NOW_SHOWING">NOW_SHOWING</option>
                  <option value="UPCOMING">UPCOMING</option>
                  <option value="COMPLETED">COMPLETED</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Rating (optional, 1-10)</label>
                <input
                  type="number"
                  step="0.1"
                  max={10}
                  min={0}
                  value={form.rating}
                  onChange={(e) => setForm({ ...form, rating: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono"
                />
              </div>
              <div className="flex items-end pb-2">
                <label className="inline-flex items-center gap-2 font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.is_top_selling}
                    onChange={(e) => setForm({ ...form, is_top_selling: e.target.checked })}
                  />
                  Mark as Top Selling
                </label>
              </div>
              <div className="sm:col-span-2 space-y-2">
                <label className="block font-semibold text-slate-700">Poster Image (Upload File or Paste Image URL)</label>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer font-semibold shrink-0">
                    <Upload className="w-3.5 h-3.5" />
                    Upload Poster
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleFileUpload(e.target.files?.[0])}
                    />
                  </label>
                  <input
                    type="text"
                    value={form.poster_url}
                    onChange={(e) => setForm({ ...form, poster_url: e.target.value })}
                    placeholder="https://... or upload an image file"
                    className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-slate-200 text-xs"
                  />
                  {form.poster_url && (
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, poster_url: '' })}
                      className="px-2.5 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs text-slate-600"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Description</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Cast (Name - Role per line)</label>
                <textarea
                  rows={3}
                  value={form.castText}
                  onChange={(e) => setForm({ ...form, castText: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Crew (Name - Role per line)</label>
                <textarea
                  rows={3}
                  value={form.crewText}
                  onChange={(e) => setForm({ ...form, crewText: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-mono"
                />
              </div>
            </div>
            <div className="px-5 py-3.5 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
              >
                Save Movie
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// MODULE 6: DYNAMIC MOVIE-WISE & CATEGORY-WISE PRICING
export function AdminPricingModule({ onDataChanged }: { onDataChanged: () => void }) {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [theatres, setTheatres] = useState<Theatre[]>([]);
  const [screens, setScreens] = useState<Screen[]>([]);
  const [shows, setShows] = useState<Show[]>([]);
  const [rules, setRules] = useState<MoviePricingRule[]>([]);
  const [categories, setCategories] = useState<
    Array<{ id: string; name: string; color: string; default_price: number; screens: string[] }>
  >([]);
  const [selectedMovieId, setSelectedMovieId] = useState('');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [form, setForm] = useState({
    movie_id: '',
    theatre_id: '',
    screen_id: '',
    show_id: '',
    category_id: '',
    price: 180,
  });

  const load = useCallback(async () => {
    try {
      const [prRes, mvRes, thRes, scRes, shRes] = await Promise.all([
        apiFetch<{ rules: MoviePricingRule[]; categories: typeof categories }>('/api/admin/pricing'),
        apiFetch<{ movies: Movie[] }>('/api/admin/movies'),
        apiFetch<{ theatres: Theatre[] }>('/api/admin/theatres'),
        apiFetch<{ screens: Screen[] }>('/api/admin/screens'),
        apiFetch<{ shows: Show[] }>('/api/admin/shows'),
      ]);
      setRules(prRes.rules);
      setCategories(prRes.categories);
      setMovies(mvRes.movies);
      setTheatres(thRes.theatres);
      setScreens(scRes.screens);
      setShows(shRes.shows);
      if (!selectedMovieId && mvRes.movies[0]) {
        setSelectedMovieId(mvRes.movies[0].id);
        setForm((f) => ({
          ...f,
          movie_id: mvRes.movies[0].id,
          category_id: prRes.categories[0]?.id || '',
        }));
      }
    } catch (err) {
      setMsg({ type: 'err', text: (err as Error).message });
    }
  }, [selectedMovieId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await apiFetch('/api/admin/pricing', {
        method: 'POST',
        body: JSON.stringify({
          movie_id: form.movie_id,
          theatre_id: form.theatre_id || null,
          screen_id: form.screen_id || null,
          show_id: form.show_id || null,
          category_id: form.category_id,
          price: Number(form.price),
        }),
      });
      setMsg({ type: 'ok', text: 'Movie-wise dynamic pricing saved & active immediately on customer seat maps.' });
      await load();
      onDataChanged();
    } catch (err) {
      setMsg({ type: 'err', text: (err as Error).message });
    }
  };

  const handleQuickMatrixUpdate = async (movieId: string, categoryId: string, price: number) => {
    if (!movieId || !categoryId) return;
    try {
      await apiFetch('/api/admin/pricing', {
        method: 'POST',
        body: JSON.stringify({ movie_id: movieId, category_id: categoryId, price }),
      });
      setMsg({ type: 'ok', text: `Updated ${categoryId} to ${formatINR(price)} for selected movie only.` });
      await load();
      onDataChanged();
    } catch (err) {
      setMsg({ type: 'err', text: (err as Error).message });
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      await apiFetch(`/api/admin/pricing/${id}`, { method: 'DELETE' });
      await load();
      onDataChanged();
    } catch (err) {
      setMsg({ type: 'err', text: (err as Error).message });
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display font-bold text-lg text-slate-950">Dynamic Categories &amp; Movie-Wise Pricing</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Priority Cascade: <strong>1. Individual Seat Override</strong> → <strong>2. Show Category Price</strong> →{' '}
          <strong>3. Movie Category Price</strong> → <strong>4. Screen Default</strong>. Changing one movie never affects another.
        </p>
      </div>

      {msg && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-xs font-medium ${
            msg.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Quick Movie-Wise Category Pricing Matrix */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display font-bold text-sm text-slate-950">Independent Movie-Wise Category Prices</h3>
          <select
            value={selectedMovieId}
            onChange={(e) => {
              setSelectedMovieId(e.target.value);
              setForm((f) => ({ ...f, movie_id: e.target.value }));
            }}
            className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold bg-white"
          >
            {movies.length === 0 && <option value="">No Movies Added Yet</option>}
            {movies.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title} ({m.language})
              </option>
            ))}
          </select>
        </div>

        {movies.length === 0 || categories.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
            {movies.length === 0
              ? 'No Movies Added Yet. Add a theatre, screen, and movie to configure movie-wise category pricing.'
              : 'No screen seat categories found yet. Add a theatre and screen to configure category prices.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {categories.map((cat) => {
              const movieRule = rules.find(
                (r) => r.movie_id === selectedMovieId && r.category_id === cat.id && !r.theatre_id && !r.screen_id && !r.show_id
              );
              const activePrice = movieRule ? movieRule.price : cat.default_price;
              return (
                <div key={cat.id} className="p-3.5 rounded-xl border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-display font-bold text-xs text-slate-950 flex items-center gap-2">
                      <span className="w-3 h-3 rounded-xs" style={{ backgroundColor: cat.color }} />
                      {cat.name}
                    </span>
                    <span className="text-[11px] text-slate-400">Default {formatINR(cat.default_price)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      defaultValue={activePrice}
                      key={`${selectedMovieId}_${cat.id}_${activePrice}`}
                      onBlur={(e) => {
                        const val = Number(e.target.value);
                        if (!Number.isNaN(val) && val !== activePrice) {
                          handleQuickMatrixUpdate(selectedMovieId, cat.id, val);
                        }
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 font-mono text-sm font-bold text-slate-950"
                    />
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {movieRule ? 'Custom Movie Override' : 'Using Screen Default'}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Granular Theatre / Screen / Show Override Form */}
      <form onSubmit={handleSaveRule} className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
        <h3 className="font-display font-bold text-sm text-slate-950">Add Granular Pricing Override (Show / Screen / Theatre)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 text-xs">
          <div>
            <label className="block font-semibold text-slate-600 mb-1">Movie</label>
            <select
              required
              value={form.movie_id}
              onChange={(e) => setForm({ ...form, movie_id: e.target.value })}
              className="w-full px-2.5 py-2 rounded-lg border border-slate-200 bg-white"
            >
              {movies.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-600 mb-1">Category</label>
            <select
              required
              value={form.category_id}
              onChange={(e) => setForm({ ...form, category_id: e.target.value })}
              className="w-full px-2.5 py-2 rounded-lg border border-slate-200 bg-white"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-600 mb-1">Theatre (optional)</label>
            <select
              value={form.theatre_id}
              onChange={(e) => setForm({ ...form, theatre_id: e.target.value })}
              className="w-full px-2.5 py-2 rounded-lg border border-slate-200 bg-white"
            >
              <option value="">All Theatres</option>
              {theatres.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-600 mb-1">Screen (optional)</label>
            <select
              value={form.screen_id}
              onChange={(e) => setForm({ ...form, screen_id: e.target.value })}
              className="w-full px-2.5 py-2 rounded-lg border border-slate-200 bg-white"
            >
              <option value="">All Screens</option>
              {screens.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.theatre_name} · {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-600 mb-1">Show (optional)</label>
            <select
              value={form.show_id}
              onChange={(e) => setForm({ ...form, show_id: e.target.value })}
              className="w-full px-2.5 py-2 rounded-lg border border-slate-200 bg-white"
            >
              <option value="">All Shows</option>
              {shows
                .filter((sh) => !form.movie_id || sh.movie_id === form.movie_id)
                .slice(0, 30)
                .map((sh) => (
                  <option key={sh.id} value={sh.id}>
                    {sh.show_date} {sh.start_time} ({sh.theatre_logo_code})
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-600 mb-1">Price (₹ INR)</label>
            <div className="flex gap-1.5">
              <input
                type="number"
                min={0}
                required
                value={form.price}
                onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
                className="w-full px-2.5 py-2 rounded-lg border border-slate-200 font-mono font-bold"
              />
              <button
                type="submit"
                className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shrink-0"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* Active Rules Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-2.5 px-4 font-semibold">Movie</th>
                <th className="py-2.5 px-4 font-semibold">Category</th>
                <th className="py-2.5 px-4 font-semibold">Scope</th>
                <th className="py-2.5 px-4 font-semibold text-right">Configured Price</th>
                <th className="py-2.5 px-4 font-semibold text-right">Remove</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {rules.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-500">
                    No custom pricing rules configured yet.
                  </td>
                </tr>
              ) : (
                rules.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-semibold text-slate-950">{r.movie_title}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-700">{r.category_id}</td>
                    <td className="py-2.5 px-4 text-slate-600">
                      {r.show_id
                        ? `Show Override (${r.show_id})`
                        : r.screen_name
                        ? `Screen: ${r.screen_name}`
                        : r.theatre_name
                        ? `Theatre: ${r.theatre_name}`
                        : 'All Theatres (Movie Default)'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-bold text-emerald-700">{formatINR(r.price)}</td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleDeleteRule(r.id)}
                        className="p-1.5 rounded-lg hover:bg-rose-100 text-rose-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// MODULE 7: SHOW MANAGEMENT (TABLE + CALENDAR VIEW + OVERLAP PREVENTION)
export function AdminShowsModule({ onDataChanged }: { onDataChanged: () => void }) {
  const [shows, setShows] = useState<Show[]>([]);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [theatres, setTheatres] = useState<Theatre[]>([]);
  const [screens, setScreens] = useState<Screen[]>([]);
  const [viewMode, setViewMode] = useState<'TABLE' | 'CALENDAR'>('TABLE');
  const [filterDate, setFilterDate] = useState('');
  const [filterMovie, setFilterMovie] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Show | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [form, setForm] = useState({
    movie_id: '',
    theatre_id: '',
    screen_id: '',
    show_date: new Date().toISOString().slice(0, 10),
    start_time: '09:30 AM',
    end_time: '12:30 PM',
    language: 'Tamil',
    format: '4K 2D',
    sound_system: 'Dolby Atmos',
    status: 'ACTIVE' as Show['status'],
  });

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterDate) params.set('date', filterDate);
      if (filterMovie) params.set('movie_id', filterMovie);
      const [shRes, mvRes, thRes, scRes] = await Promise.all([
        apiFetch<{ shows: Show[] }>(`/api/admin/shows?${params.toString()}`),
        apiFetch<{ movies: Movie[] }>('/api/admin/movies'),
        apiFetch<{ theatres: Theatre[] }>('/api/admin/theatres'),
        apiFetch<{ screens: Screen[] }>('/api/admin/screens'),
      ]);
      setShows(shRes.shows);
      setMovies(mvRes.movies);
      setTheatres(thRes.theatres);
      setScreens(scRes.screens);
    } catch (err) {
      setMsg({ type: 'err', text: (err as Error).message });
    }
  }, [filterDate, filterMovie]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = (seedShow?: Show) => {
    setEditing(null);
    const thId = seedShow?.theatre_id || theatres[0]?.id || '';
    const scr = screens.find((s) => s.theatre_id === thId);
    setForm({
      movie_id: seedShow?.movie_id || movies[0]?.id || '',
      theatre_id: thId,
      screen_id: seedShow?.screen_id || scr?.id || '',
      show_date: seedShow?.show_date || new Date().toLocaleDateString('en-CA'),
      start_time: seedShow?.start_time || '10:00 AM',
      end_time: seedShow?.end_time || '01:00 PM',
      language: seedShow?.language || 'Tamil',
      format: seedShow?.format || '4K 2D',
      sound_system: seedShow?.sound_system || 'Dolby Atmos',
      status: 'ACTIVE',
    });
    setModalOpen(true);
  };

  const openEdit = (sh: Show) => {
    setEditing(sh);
    setForm({
      movie_id: sh.movie_id,
      theatre_id: sh.theatre_id,
      screen_id: sh.screen_id,
      show_date: sh.show_date,
      start_time: sh.start_time,
      end_time: sh.end_time,
      language: sh.language,
      format: sh.format,
      sound_system: sh.sound_system,
      status: sh.status,
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (!form.movie_id || !form.theatre_id || !form.screen_id) {
      setMsg({ type: 'err', text: 'Please select a valid movie, theatre, and screen before saving.' });
      return;
    }
    try {
      if (editing) {
        await apiFetch(`/api/admin/shows/${editing.id}`, { method: 'PUT', body: JSON.stringify(form) });
        setMsg({ type: 'ok', text: 'Show updated.' });
      } else {
        await apiFetch('/api/admin/shows', { method: 'POST', body: JSON.stringify(form) });
        setMsg({ type: 'ok', text: 'Show scheduled (overlap check passed).' });
      }
      setModalOpen(false);
      await load();
      onDataChanged();
    } catch (err) {
      setMsg({ type: 'err', text: (err as Error).message });
    }
  };

  const handleDelete = async (sh: Show) => {
    setMsg(null);
    try {
      await apiFetch(`/api/admin/shows/${sh.id}`, { method: 'DELETE' });
      setMsg({ type: 'ok', text: `Deleted show (${sh.show_date} · ${sh.start_time}).` });
      await load();
      onDataChanged();
    } catch (err) {
      setMsg({ type: 'err', text: (err as Error).message });
    }
  };

  const theatreScreens = screens.filter((s) => s.theatre_id === form.theatre_id);

  // Group shows by date for Calendar View
  const showsByDate = shows.reduce<Record<string, Show[]>>((acc, s) => {
    acc[s.show_date] = acc[s.show_date] || [];
    acc[s.show_date].push(s);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-lg text-slate-950">Show Management</h2>
          <p className="text-xs text-slate-500">Schedule multiple daily shows per screen with automatic overlap prevention</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-mono"
          />
          <select
            value={filterMovie}
            onChange={(e) => setFilterMovie(e.target.value)}
            className="px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-xs"
          >
            <option value="">All Movies</option>
            {movies.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('TABLE')}
              className={`px-2.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1 ${
                viewMode === 'TABLE' ? 'bg-slate-950 text-white' : 'text-slate-600'
              }`}
            >
              <Table className="w-3.5 h-3.5" />
              Table
            </button>
            <button
              type="button"
              onClick={() => setViewMode('CALENDAR')}
              className={`px-2.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1 ${
                viewMode === 'CALENDAR' ? 'bg-slate-950 text-white' : 'text-slate-600'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              Calendar
            </button>
          </div>
          <button
            type="button"
            onClick={() => openCreate()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
          >
            <Plus className="w-4 h-4" />
            Create Show
          </button>
        </div>
      </div>

      {msg && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-xs font-medium ${
            msg.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {msg.text}
        </div>
      )}

      {viewMode === 'TABLE' ? (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Date &amp; Time</th>
                  <th className="py-2.5 px-4 font-semibold">Movie</th>
                  <th className="py-2.5 px-4 font-semibold">Theatre / Screen</th>
                  <th className="py-2.5 px-4 font-semibold">Format</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Seats (Avail/Booked/Blk)</th>
                  <th className="py-2.5 px-4 font-semibold">Indicator</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {shows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 px-4 text-center">
                      <p className="font-display font-bold text-sm text-slate-900">No Shows Scheduled Yet</p>
                      <p className="text-xs text-slate-500 mt-1">
                        {movies.length === 0 || theatres.length === 0
                          ? 'Add your movies, theatres, and screens first, then schedule showtimes here.'
                          : 'Click Create Show to schedule your first screening.'}
                      </p>
                    </td>
                  </tr>
                ) : (
                  shows.slice(0, 80).map((sh) => {
                    const m = sh.metrics;
                    const ind = getIndicatorMeta(m?.indicator || 'AVAILABLE');
                    return (
                      <tr key={sh.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 font-mono text-slate-800 whitespace-nowrap">
                          {sh.show_date} · {sh.start_time} – {sh.end_time}
                        </td>
                        <td className="py-2.5 px-4 font-semibold text-slate-950">{sh.movie_title}</td>
                        <td className="py-2.5 px-4 text-slate-600">
                          {sh.theatre_logo_code} · {sh.screen_name}
                        </td>
                        <td className="py-2.5 px-4 text-slate-600">
                          {sh.format} · {sh.sound_system}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-slate-700">
                          {m?.available_seats ?? 0} / {m?.booked_seats ?? 0} / {m?.blocked_seats ?? 0}
                        </td>
                        <td className={`py-2.5 px-4 font-semibold whitespace-nowrap ${ind.textClass}`}>{ind.label}</td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openCreate(sh)}
                            title="Duplicate Show"
                            className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-600 mr-1"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEdit(sh)}
                            title="Edit Show"
                            className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-700 mr-1"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(sh)}
                            title="Delete Show"
                            className="p-1.5 rounded-lg hover:bg-rose-100 text-rose-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.keys(showsByDate).length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
              <p className="font-display font-bold text-sm text-slate-900">No Shows Scheduled Yet</p>
              <p className="text-xs text-slate-500 mt-1">Scheduled showtimes will appear grouped by date here.</p>
            </div>
          ) : (
            Object.entries(showsByDate).map(([date, list]) => (
              <div key={date} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                <h3 className="font-mono font-bold text-sm text-slate-950">{date} ({list.length} shows)</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {list.map((sh) => {
                    const ind = getIndicatorMeta(sh.metrics?.indicator || 'AVAILABLE');
                    return (
                      <div key={sh.id} className="p-3 rounded-xl border border-slate-200 text-xs flex justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-mono font-bold text-slate-950">
                            {sh.start_time} – {sh.end_time}
                          </div>
                          <div className="font-semibold text-slate-800 truncate">{sh.movie_title}</div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {sh.theatre_logo_code} · {sh.screen_name}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`font-semibold ${ind.textClass}`}>{ind.label}</div>
                          <div className="font-mono text-[11px] text-slate-500">{sh.metrics?.available_seats} left</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form onSubmit={handleSave} className="bg-white w-full max-w-lg rounded-2xl border border-slate-200 shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-display font-bold text-base text-slate-950">
                {editing ? 'Edit Show' : 'Schedule New Show'}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Movie</label>
                <select
                  required
                  value={form.movie_id}
                  onChange={(e) => setForm({ ...form, movie_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm"
                >
                  {movies.length === 0 ? (
                    <option value="">No Movies Added Yet</option>
                  ) : (
                    movies.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title} ({m.language})
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Theatre</label>
                <select
                  required
                  value={form.theatre_id}
                  onChange={(e) => {
                    const tid = e.target.value;
                    const firstScreen = screens.find((s) => s.theatre_id === tid)?.id || '';
                    setForm({ ...form, theatre_id: tid, screen_id: firstScreen });
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm"
                >
                  {theatres.length === 0 ? (
                    <option value="">No Theatres Added Yet</option>
                  ) : (
                    theatres.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Screen</label>
                <select
                  required
                  value={form.screen_id}
                  onChange={(e) => setForm({ ...form, screen_id: e.target.value })}
                  disabled={theatreScreens.length === 0}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm disabled:bg-slate-100 disabled:text-slate-400"
                >
                  {theatreScreens.length === 0 ? (
                    <option value="">No screens in this theatre</option>
                  ) : (
                    theatreScreens.map((s) => (
                      <option key={s.id} value={s.id}>
                        #{s.screen_number} · {s.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Show Date</label>
                <input
                  type="date"
                  required
                  value={form.show_date}
                  onChange={(e) => setForm({ ...form, show_date: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Language</label>
                <input
                  type="text"
                  value={form.language}
                  onChange={(e) => setForm({ ...form, language: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Start Time (e.g. 09:30 AM)</label>
                <input
                  type="text"
                  required
                  value={form.start_time}
                  onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">End Time (e.g. 12:30 PM)</label>
                <input
                  type="text"
                  required
                  value={form.end_time}
                  onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Format</label>
                <input
                  type="text"
                  value={form.format}
                  onChange={(e) => setForm({ ...form, format: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Sound System</label>
                <input
                  type="text"
                  value={form.sound_system}
                  onChange={(e) => setForm({ ...form, sound_system: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Show Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as Show['status'] })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                  <option value="CANCELLED">CANCELLED</option>
                </select>
              </div>
            </div>
            <div className="px-5 py-3.5 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!form.movie_id || !form.theatre_id || !form.screen_id}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold"
              >
                Save Show
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
