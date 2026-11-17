import { Grid3X3, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import type { Screen, Theatre } from '../../types';

const ALL_FACILITIES = [
  'Dolby Atmos',
  'Dolby Digital',
  'DTS',
  '4K Laser',
  '4K RGB Laser',
  'IMAX',
  '3D',
  'Parking',
  'Air Conditioning',
];

export function AdminTheatresModule({ onDataChanged }: { onDataChanged: () => void }) {
  const [theatres, setTheatres] = useState<Theatre[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Theatre | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [form, setForm] = useState({
    name: '',
    logo_code: '',
    address: '',
    city: 'Tirunelveli',
    district: 'Tirunelveli',
    maps_location: '',
    distance_km: 2.5,
    contact_number: '',
    facilities: ['Dolby Atmos', '4K Laser', 'Parking', 'Air Conditioning'] as string[],
    is_cancellable: true,
    cancellation_policy: 'Cancellable up to 2 hrs before show',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ theatres: Theatre[] }>('/api/admin/theatres');
      setTheatres(res.theatres);
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
      name: '',
      logo_code: '',
      address: '',
      city: 'Tirunelveli',
      district: 'Tirunelveli',
      maps_location: '',
      distance_km: 2.5,
      contact_number: '',
      facilities: ['Dolby Atmos', '4K Laser', 'Parking', 'Air Conditioning'],
      is_cancellable: true,
      cancellation_policy: 'Cancellable up to 2 hrs before show',
      status: 'ACTIVE',
    });
    setModalOpen(true);
  };

  const openEdit = (t: Theatre) => {
    setEditing(t);
    setForm({
      name: t.name,
      logo_code: t.logo_code,
      address: t.address,
      city: t.city,
      district: t.district,
      maps_location: t.maps_location,
      distance_km: t.distance_km,
      contact_number: t.contact_number,
      facilities: t.facilities,
      is_cancellable: t.is_cancellable,
      cancellation_policy: t.cancellation_policy,
      status: t.status,
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      if (editing) {
        await apiFetch(`/api/admin/theatres/${editing.id}`, { method: 'PUT', body: JSON.stringify(form) });
        setMsg({ type: 'ok', text: `Updated ${form.name}.` });
      } else {
        await apiFetch('/api/admin/theatres', { method: 'POST', body: JSON.stringify(form) });
        setMsg({ type: 'ok', text: `Created theatre ${form.name}.` });
      }
      setModalOpen(false);
      await load();
      onDataChanged();
    } catch (err) {
      setMsg({ type: 'err', text: (err as Error).message });
    }
  };

  const handleToggleStatus = async (t: Theatre) => {
    try {
      const nextStatus = t.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      await apiFetch(`/api/admin/theatres/${t.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: nextStatus }),
      });
      await load();
      onDataChanged();
    } catch (err) {
      setMsg({ type: 'err', text: (err as Error).message });
    }
  };

  const handleDelete = async (t: Theatre) => {
    try {
      await apiFetch(`/api/admin/theatres/${t.id}`, { method: 'DELETE' });
      setMsg({ type: 'ok', text: `Deleted ${t.name}.` });
      await load();
      onDataChanged();
    } catch (err) {
      setMsg({ type: 'err', text: (err as Error).message });
    }
  };

  const toggleFacility = (f: string) => {
    setForm((prev) => ({
      ...prev,
      facilities: prev.facilities.includes(f) ? prev.facilities.filter((x) => x !== f) : [...prev.facilities, f],
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-lg text-slate-950">Theatre Management</h2>
          <p className="text-xs text-slate-500">Manage multiplex locations, audio/projection facilities &amp; policies</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
        >
          <Plus className="w-4 h-4" />
          Add Theatre
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
                <th className="py-3 px-4 font-semibold">Theatre</th>
                <th className="py-3 px-4 font-semibold">Location &amp; Contact</th>
                <th className="py-3 px-4 font-semibold">Facilities</th>
                <th className="py-3 px-4 font-semibold text-right">Screens / Shows</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    Loading theatres...
                  </td>
                </tr>
              ) : theatres.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 px-4 text-center">
                    <p className="font-display font-bold text-sm text-slate-900">No Theatres Added Yet</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Add your first cinema property to configure screens, layouts, and show schedules.
                    </p>
                    <button
                      type="button"
                      onClick={openCreate}
                      className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                    >
                      <Plus className="w-4 h-4" />
                      Add Theatre
                    </button>
                  </td>
                </tr>
              ) : (
                theatres.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <span className="w-8 h-8 rounded-lg bg-slate-950 text-white font-display font-bold text-[11px] flex items-center justify-center shrink-0">
                          {t.logo_code}
                        </span>
                        <div>
                          <div className="font-semibold text-slate-950">{t.name}</div>
                          <div className="text-[11px] text-slate-500">{t.cancellation_policy}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      <div>{t.address}</div>
                      <div className="text-[11px] text-slate-400">
                        {t.city}, {t.district} · {t.contact_number}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600 max-w-xs">{t.facilities.join(' · ')}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                      {t.screen_count ?? 0} / {t.active_show_count ?? 0}
                    </td>
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(t)}
                        className={`font-semibold text-xs ${
                          t.status === 'ACTIVE' ? 'text-emerald-700' : 'text-slate-400'
                        }`}
                      >
                        {t.status}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openEdit(t)}
                        className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-700 mr-1"
                        title="Edit Theatre"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(t)}
                        className="p-1.5 rounded-lg hover:bg-rose-100 text-rose-600"
                        title="Delete Theatre"
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
                {editing ? 'Edit Theatre' : 'Add New Theatre'}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Theatre Name</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Logo Monogram (3-4 chars)</label>
                <input
                  type="text"
                  maxLength={4}
                  value={form.logo_code}
                  onChange={(e) => setForm({ ...form, logo_code: e.target.value.toUpperCase() })}
                  placeholder="TH1"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono uppercase"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Contact Number</label>
                <input
                  type="text"
                  value={form.contact_number}
                  onChange={(e) => setForm({ ...form, contact_number: e.target.value })}
                  placeholder="+91 4633 221 900"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Address</label>
                <input
                  type="text"
                  required
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">City</label>
                <input
                  type="text"
                  required
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">District</label>
                <input
                  type="text"
                  value={form.district}
                  onChange={(e) => setForm({ ...form, district: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Google Maps Location URL</label>
                <input
                  type="text"
                  value={form.maps_location}
                  onChange={(e) => setForm({ ...form, maps_location: e.target.value })}
                  placeholder="https://maps.google.com/?q=..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Distance (km)</label>
                <input
                  type="number"
                  step="0.1"
                  value={form.distance_km}
                  onChange={(e) => setForm({ ...form, distance_km: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1.5">Facilities</label>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_FACILITIES.map((f) => {
                    const active = form.facilities.includes(f);
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() => toggleFacility(f)}
                        className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                          active
                            ? 'bg-slate-950 text-white border-slate-950'
                            : 'bg-white text-slate-700 border-slate-200'
                        }`}
                      >
                        {f}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="inline-flex items-center gap-2 font-semibold text-slate-700 pt-2">
                  <input
                    type="checkbox"
                    checked={form.is_cancellable}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        is_cancellable: e.target.checked,
                        cancellation_policy: e.target.checked
                          ? 'Cancellable up to 2 hrs before show'
                          : 'Non-cancellable',
                      })
                    }
                  />
                  Allow Ticket Cancellation
                </label>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Cancellation Policy Label</label>
                <input
                  type="text"
                  value={form.cancellation_policy}
                  onChange={(e) => setForm({ ...form, cancellation_policy: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                />
              </div>
            </div>
            <div className="px-5 py-3.5 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
              >
                {editing ? 'Update Theatre' : 'Create Theatre'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export function AdminScreensModule({
  onOpenLayoutDesigner,
  onDataChanged,
}: {
  onOpenLayoutDesigner: (screenId: string) => void;
  onDataChanged: () => void;
}) {
  const [screens, setScreens] = useState<Screen[]>([]);
  const [theatres, setTheatres] = useState<Theatre[]>([]);
  const [filterTheatre, setFilterTheatre] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Screen | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [form, setForm] = useState({
    theatre_id: '',
    screen_number: 1,
    name: 'ATMOS/SCREEN 1',
    screen_type: '4K RGB Laser',
    sound_system: 'Dolby Atmos',
    projection_type: '4K RGB Laser',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
  });

  const load = useCallback(async () => {
    try {
      const [scRes, thRes] = await Promise.all([
        apiFetch<{ screens: Screen[] }>(
          `/api/admin/screens${filterTheatre ? `?theatre_id=${encodeURIComponent(filterTheatre)}` : ''}`
        ),
        apiFetch<{ theatres: Theatre[] }>('/api/admin/theatres'),
      ]);
      setScreens(scRes.screens);
      setTheatres(thRes.theatres);
    } catch (err) {
      setMsg({ type: 'err', text: (err as Error).message });
    }
  }, [filterTheatre]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      theatre_id: theatres[0]?.id || '',
      screen_number: screens.length + 1,
      name: `SCREEN ${screens.length + 1}`,
      screen_type: '2D / 4K',
      sound_system: 'Dolby Atmos',
      projection_type: '4K Laser',
      status: 'ACTIVE',
    });
    setModalOpen(true);
  };

  const openEdit = (sc: Screen) => {
    setEditing(sc);
    setForm({
      theatre_id: sc.theatre_id,
      screen_number: sc.screen_number,
      name: sc.name,
      screen_type: sc.screen_type,
      sound_system: sc.sound_system,
      projection_type: sc.projection_type,
      status: sc.status,
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      if (editing) {
        await apiFetch(`/api/admin/screens/${editing.id}`, { method: 'PUT', body: JSON.stringify(form) });
        setMsg({ type: 'ok', text: `Updated ${form.name}.` });
      } else {
        await apiFetch('/api/admin/screens', { method: 'POST', body: JSON.stringify(form) });
        setMsg({ type: 'ok', text: `Created screen ${form.name} with default Schema v2.0 layout.` });
      }
      setModalOpen(false);
      await load();
      onDataChanged();
    } catch (err) {
      setMsg({ type: 'err', text: (err as Error).message });
    }
  };

  const handleDelete = async (sc: Screen) => {
    try {
      await apiFetch(`/api/admin/screens/${sc.id}`, { method: 'DELETE' });
      setMsg({ type: 'ok', text: `Deleted ${sc.name}.` });
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
          <h2 className="font-display font-bold text-lg text-slate-950">Screen Management</h2>
          <p className="text-xs text-slate-500">Configure auditoriums, projection, sound systems &amp; seat capacity</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterTheatre}
            onChange={(e) => setFilterTheatre(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium"
          >
            <option value="">All Theatres</option>
            {theatres.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
          >
            <Plus className="w-4 h-4" />
            Add Screen
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

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-3 px-4 font-semibold">Screen</th>
                <th className="py-3 px-4 font-semibold">Theatre</th>
                <th className="py-3 px-4 font-semibold">Projection &amp; Sound</th>
                <th className="py-3 px-4 font-semibold text-right">Seats / Canvas</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {screens.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 px-4 text-center">
                    <p className="font-display font-bold text-sm text-slate-900">
                      {theatres.length === 0 ? 'No Theatres Added Yet' : 'No Screens Added Yet'}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {theatres.length === 0
                        ? 'Add a theatre first in Theatre Management before creating screens.'
                        : 'Add an auditorium screen to configure seating layout and schedule shows.'}
                    </p>
                    {theatres.length > 0 && (
                      <button
                        type="button"
                        onClick={openCreate}
                        className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                      >
                        <Plus className="w-4 h-4" />
                        Add Screen
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                screens.map((sc) => (
                <tr key={sc.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-950">
                      #{sc.screen_number} · {sc.name}
                    </div>
                    <div className="text-[11px] font-mono text-slate-400">{sc.id}</div>
                  </td>
                  <td className="py-3 px-4 text-slate-700">{sc.theatre_name}</td>
                  <td className="py-3 px-4 text-slate-600">
                    {sc.projection_type} · {sc.sound_system} ({sc.screen_type})
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-slate-700">
                    {sc.capacity} seats · {sc.layout.screen_width}×{sc.layout.screen_height}
                  </td>
                  <td className="py-3 px-4 font-semibold text-emerald-700">{sc.status}</td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onOpenLayoutDesigner(sc.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-white text-[11px] font-semibold mr-1.5"
                    >
                      <Grid3X3 className="w-3 h-3" />
                      Layout Designer
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(sc)}
                      className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-700 mr-1"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(sc)}
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
          <form onSubmit={handleSave} className="bg-white w-full max-w-lg rounded-2xl border border-slate-200 shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-display font-bold text-base text-slate-950">
                {editing ? 'Edit Screen' : 'Add Screen'}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Theatre</label>
                <select
                  required
                  disabled={Boolean(editing) || theatres.length === 0}
                  value={form.theatre_id}
                  onChange={(e) => setForm({ ...form, theatre_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white disabled:bg-slate-100 disabled:text-slate-400"
                >
                  {theatres.length === 0 ? (
                    <option value="">No theatres added yet</option>
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
                <label className="block font-semibold text-slate-700 mb-1">Screen Number</label>
                <input
                  type="number"
                  min={1}
                  required
                  value={form.screen_number}
                  onChange={(e) => setForm({ ...form, screen_number: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Screen Name</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Projection Type</label>
                <input
                  type="text"
                  value={form.projection_type}
                  onChange={(e) => setForm({ ...form, projection_type: e.target.value })}
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
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Screen Format</label>
                <input
                  type="text"
                  value={form.screen_type}
                  onChange={(e) => setForm({ ...form, screen_type: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as 'ACTIVE' | 'INACTIVE' })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
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
                disabled={!form.theatre_id}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold"
              >
                Save Screen
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
