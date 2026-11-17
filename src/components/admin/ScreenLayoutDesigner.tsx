import {
  Download,
  Grid,
  Minus,
  Plus,
  Redo2,
  Save,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api';
import type {
  LayoutAisle,
  LayoutCategory,
  LayoutSeat,
  Screen,
  ScreenLayoutV2,
  SeatBlock,
  SeatType,
} from '../../types';
import { JsonLayoutImportModal } from './JsonLayoutImportModal';

interface ScreenLayoutDesignerProps {
  initialScreenId?: string | null;
  onDataChanged: () => void;
}

export function ScreenLayoutDesigner({ initialScreenId, onDataChanged }: ScreenLayoutDesignerProps) {
  const [screens, setScreens] = useState<Screen[]>([]);
  const [activeScreenId, setActiveScreenId] = useState<string>(initialScreenId || '');
  const [layout, setLayout] = useState<ScreenLayoutV2 | null>(null);
  const [history, setHistory] = useState<ScreenLayoutV2[]>([]);
  const [future, setFuture] = useState<ScreenLayoutV2[]>([]);

  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [selectedAisleId, setSelectedAisleId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.85);
  const [showGrid, setShowGrid] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [importModalOpen, setImportModalOpen] = useState(false);

  // Dragging ref
  const dragRef = useRef<{
    seatId: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const loadScreens = useCallback(async () => {
    try {
      const res = await apiFetch<{ screens: Screen[] }>('/api/admin/screens');
      setScreens(res.screens);
      const targetId = initialScreenId || activeScreenId || res.screens[0]?.id || '';
      if (targetId) {
        setActiveScreenId(targetId);
        const found = res.screens.find((s) => s.id === targetId);
        if (found) {
          setLayout(found.layout);
          setHistory([]);
          setFuture([]);
        }
      }
    } catch (err) {
      setMsg({ type: 'err', text: (err as Error).message });
    }
  }, [initialScreenId, activeScreenId]);

  useEffect(() => {
    loadScreens();
  }, [loadScreens]);

  const selectScreen = (screenId: string) => {
    setActiveScreenId(screenId);
    const found = screens.find((s) => s.id === screenId);
    if (found) {
      setLayout(found.layout);
      setHistory([]);
      setFuture([]);
      setSelectedSeatId(null);
      setSelectedAisleId(null);
      setMsg(null);
    }
  };

  const commitLayout = useCallback((next: ScreenLayoutV2) => {
    setLayout((prev) => {
      if (prev) {
        setHistory((h) => [...h.slice(-24), prev]);
        setFuture([]);
      }
      return { ...next, aisles: Array.isArray(next.aisles) ? next.aisles : [] };
    });
  }, []);

  const handleUndo = () => {
    if (history.length === 0 || !layout) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setFuture((f) => [layout, ...f]);
    setLayout(prev);
  };

  const handleRedo = () => {
    if (future.length === 0 || !layout) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setHistory((h) => [...h, layout]);
    setLayout(next);
  };

  // Drag handlers for canvas seats
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = (e.clientX - dragRef.current.startClientX) / zoom;
      const dy = (e.clientY - dragRef.current.startClientY) / zoom;
      const snap = showGrid ? 4 : 1;
      const nextX = Math.max(44, Math.round((dragRef.current.origX + dx) / snap) * snap);
      const nextY = Math.max(24, Math.round((dragRef.current.origY + dy) / snap) * snap);
      const seatId = dragRef.current.seatId;
      setLayout((prev) =>
        prev
          ? {
              ...prev,
              seats: prev.seats.map((s) => (s.id === seatId ? { ...s, x: nextX, y: nextY } : s)),
            }
          : prev
      );
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [zoom, showGrid]);

  const handleAddRow = () => {
    if (!layout) return;
    const usedLetters = new Set(layout.rows.map((r) => r.label));
    let nextCharCode = 65;
    while (usedLetters.has(String.fromCharCode(nextCharCode)) && nextCharCode < 90) {
      nextCharCode++;
    }
    const label = usedLetters.has(String.fromCharCode(nextCharCode))
      ? `R${layout.rows.length + 1}`
      : String.fromCharCode(nextCharCode);
    const maxY = layout.rows.length > 0 ? Math.max(...layout.rows.map((r) => r.y)) : 40;
    const newY = maxY + 42;
    const defaultCat = layout.categories[layout.categories.length - 1]?.id || 'cat_standard';

    const newSeats: LayoutSeat[] = Array.from({ length: 8 }, (_, i) => ({
      id: `${label}${i + 1}`,
      row: label,
      number: i + 1,
      x: 160 + i * 42 + (i >= 4 ? 32 : 0),
      y: newY,
      width: 32,
      height: 28,
      category_id: defaultCat,
      seat_type: 'NORMAL',
      block: i < 4 ? 'LEFT' : 'RIGHT',
      price_override: null,
    }));

    commitLayout({
      ...layout,
      screen_height: Math.max(layout.screen_height, newY + 70),
      rows: [...layout.rows, { label, y: newY, category_id: defaultCat }],
      seats: [...layout.seats, ...newSeats],
      categories: layout.categories.map((c) =>
        c.id === defaultCat ? { ...c, rows: [...c.rows, label] } : c
      ),
    });
  };

  const handleAddSeat = () => {
    if (!layout) return;
    const refSeat = layout.seats.find((s) => s.id === selectedSeatId) || layout.seats[layout.seats.length - 1];
    const rowLabel = refSeat?.row || layout.rows[0]?.label || 'A';
    const rowSeats = layout.seats.filter((s) => s.row === rowLabel);
    const nextNum = rowSeats.length > 0 ? Math.max(...rowSeats.map((s) => s.number)) + 1 : 1;
    const newId = `${rowLabel}${nextNum}`;
    const newSeat: LayoutSeat = {
      id: newId,
      row: rowLabel,
      number: nextNum,
      x: Math.min(layout.screen_width - 48, (refSeat?.x ?? 120) + 42),
      y: refSeat?.y ?? 60,
      width: refSeat?.width ?? 32,
      height: refSeat?.height ?? 28,
      category_id: refSeat?.category_id || layout.categories[0]?.id || 'cat_gold',
      seat_type: refSeat?.seat_type || 'NORMAL',
      block: refSeat?.block || 'CENTRE',
      price_override: null,
    };
    commitLayout({ ...layout, seats: [...layout.seats, newSeat] });
    setSelectedSeatId(newId);
  };

  const handleAddAisle = (orientation: 'vertical' | 'horizontal') => {
    if (!layout) return;
    const id = `aisle_${Date.now().toString(36)}`;
    const aisle: LayoutAisle =
      orientation === 'vertical'
        ? { id, orientation: 'vertical', x: Math.round(layout.screen_width / 2) - 14, y: 40, width: 28, height: 340, label: 'Aisle' }
        : { id, orientation: 'horizontal', x: 64, y: Math.round(layout.screen_height / 2), width: layout.screen_width - 128, height: 22, label: 'Walkway' };
    commitLayout({ ...layout, aisles: [...layout.aisles, aisle] });
    setSelectedAisleId(id);
    setSelectedSeatId(null);
  };

  const handleDeleteSelected = () => {
    if (!layout) return;
    if (selectedSeatId) {
      commitLayout({ ...layout, seats: layout.seats.filter((s) => s.id !== selectedSeatId) });
      setSelectedSeatId(null);
    } else if (selectedAisleId) {
      commitLayout({ ...layout, aisles: layout.aisles.filter((a) => a.id !== selectedAisleId) });
      setSelectedAisleId(null);
    }
  };

  const handleAddCategory = () => {
    if (!layout) return;
    const idx = layout.categories.length + 1;
    const newCat: LayoutCategory = {
      id: `cat_custom_${idx}`,
      name: `TIER ${idx}`,
      color: '#0D9488',
      price: 160,
      rows: [],
    };
    commitLayout({ ...layout, categories: [...layout.categories, newCat] });
  };

  const updateCategory = (catId: string, patch: Partial<LayoutCategory>) => {
    if (!layout) return;
    commitLayout({
      ...layout,
      categories: layout.categories.map((c) => (c.id === catId ? { ...c, ...patch } : c)),
    });
  };

  const assignRowToCategory = (rowLabel: string, catId: string) => {
    if (!layout) return;
    commitLayout({
      ...layout,
      rows: layout.rows.map((r) => (r.label === rowLabel ? { ...r, category_id: catId } : r)),
      seats: layout.seats.map((s) => (s.row === rowLabel ? { ...s, category_id: catId } : s)),
      categories: layout.categories.map((c) => ({
        ...c,
        rows:
          c.id === catId
            ? Array.from(new Set([...c.rows, rowLabel]))
            : c.rows.filter((rl) => rl !== rowLabel),
      })),
    });
  };

  const handleSaveToDatabase = async () => {
    if (!layout || !activeScreenId) return;
    setSaving(true);
    setMsg(null);
    try {
      const sanitized: ScreenLayoutV2 = {
        ...layout,
        schema_version: '2.0',
        coordinate_system: 'cartesian_px',
        aisles: Array.isArray(layout.aisles) ? layout.aisles : [],
        blocked_seats: Array.isArray(layout.blocked_seats) ? layout.blocked_seats : [],
      };
      const res = await apiFetch<{ message: string; capacity: number }>(`/api/admin/screens/${activeScreenId}`, {
        method: 'PUT',
        body: JSON.stringify({ layout: sanitized }),
      });
      setMsg({ type: 'ok', text: `${res.message} (${res.capacity} seats live on customer seat map).` });
      await loadScreens();
      onDataChanged();
    } catch (err) {
      setMsg({ type: 'err', text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const handleExportJson = () => {
    if (!layout) return;
    const payload: ScreenLayoutV2 = {
      ...layout,
      aisles: Array.isArray(layout.aisles) ? layout.aisles : [],
      blocked_seats: Array.isArray(layout.blocked_seats) ? layout.blocked_seats : [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${layout.screen_id}_layout_v2.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeScreen = screens.find((s) => s.id === activeScreenId) || null;
  const selectedSeat = layout?.seats.find((s) => s.id === selectedSeatId) || null;
  const selectedAisle = layout?.aisles.find((a) => a.id === selectedAisleId) || null;
  const catColorMap = new Map(layout?.categories.map((c) => [c.id, c.color]) || []);
  const layoutBlockedSet = new Set<string>(Array.isArray(layout?.blocked_seats) ? layout.blocked_seats : []);

  return (
    <div className="space-y-4">
      {/* Top Designer Toolbar */}
      <div className="rounded-xl border border-slate-200 bg-white p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeScreenId}
            onChange={(e) => selectScreen(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-900"
          >
            {screens.length === 0 ? (
              <option value="">No Screens Added Yet</option>
            ) : (
              screens.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.theatre_name} — {s.name} ({s.capacity} seats)
                </option>
              ))
            )}
          </select>

          <button
            type="button"
            onClick={handleAddRow}
            className="px-2.5 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold"
          >
            + Row
          </button>
          <button
            type="button"
            onClick={handleAddSeat}
            className="px-2.5 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold"
          >
            + Seat
          </button>
          <button
            type="button"
            onClick={() => handleAddAisle('vertical')}
            className="px-2.5 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold"
          >
            + V-Aisle
          </button>
          <button
            type="button"
            onClick={() => handleAddAisle('horizontal')}
            className="px-2.5 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold"
          >
            + H-Walkway
          </button>
          {(selectedSeatId || selectedAisleId) && (
            <button
              type="button"
              onClick={handleDeleteSelected}
              className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-xs font-semibold"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleUndo}
            disabled={history.length === 0}
            title="Undo"
            className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={future.length === 0}
            title="Redo"
            className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setShowGrid((g) => !g)}
            title="Toggle Grid Snap"
            className={`p-2 rounded-lg border ${showGrid ? 'bg-slate-950 text-white border-slate-950' : 'border-slate-200'}`}
          >
            <Grid className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.55, Math.round((z - 0.1) * 100) / 100))}
            className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className="font-mono text-xs w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(1.3, Math.round((z + 0.1) * 100) / 100))}
            className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setImportModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold"
          >
            <Upload className="w-3.5 h-3.5" />
            Import JSON File
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold"
          >
            <Download className="w-3.5 h-3.5" />
            Export JSON
          </button>
          <button
            type="button"
            disabled={saving || !layout}
            onClick={handleSaveToDatabase}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : 'Save Layout'}
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

      {!layout ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
          <p className="font-display font-bold text-sm text-slate-900">No Screens Added Yet</p>
          <p className="text-xs text-slate-500 mt-1">
            Add a theatre in Theatre Management and create a screen in Screen Management to design or import a JSON seat layout.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4 items-start">
          {/* Interactive Visual Drag-and-Drop Canvas */}
          <div className="rounded-xl border border-slate-200 bg-slate-100 p-4 overflow-auto">
            <div className="mb-2 flex items-center justify-between text-xs text-slate-600">
              <span>
                Drag any seat to reposition · Schema v{layout.schema_version} · {layout.seats.length} seats ·{' '}
                {layout.aisles.length} aisles
              </span>
              <div className="flex items-center gap-2">
                <span>Screen Direction:</span>
                <select
                  value={layout.screen_direction}
                  onChange={(e) =>
                    commitLayout({ ...layout, screen_direction: e.target.value as 'BOTTOM' | 'TOP' })
                  }
                  className="px-2 py-1 rounded border border-slate-300 bg-white text-xs font-semibold"
                >
                  <option value="BOTTOM">BOTTOM</option>
                  <option value="TOP">TOP</option>
                </select>
              </div>
            </div>

            <div
              className="relative bg-white rounded-xl border border-slate-300 overflow-hidden mx-auto"
              style={{
                width: Math.round(layout.screen_width * zoom),
                height: Math.round(layout.screen_height * zoom),
              }}
              onClick={() => {
                setSelectedSeatId(null);
                setSelectedAisleId(null);
              }}
            >
              <div
                className="relative origin-top-left"
                style={{
                  width: layout.screen_width,
                  height: layout.screen_height,
                  transform: `scale(${zoom})`,
                  backgroundImage: showGrid
                    ? 'radial-gradient(#CBD5E1 1px, transparent 1px)'
                    : undefined,
                  backgroundSize: '20px 20px',
                }}
              >
                {/* Aisles */}
                {layout.aisles.map((a) => (
                  <div
                    key={a.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedAisleId(a.id);
                      setSelectedSeatId(null);
                    }}
                    style={{ left: a.x, top: a.y, width: a.width, height: a.height }}
                    className={`absolute border border-dashed flex items-center justify-center text-[10px] font-mono cursor-pointer ${
                      selectedAisleId === a.id
                        ? 'border-purple-600 bg-purple-100/60 text-purple-800'
                        : 'border-slate-300 bg-slate-100/50 text-slate-400'
                    }`}
                  >
                    {a.orientation === 'horizontal' ? a.label || 'Walkway' : ''}
                  </div>
                ))}

                {/* Row Labels */}
                {layout.rows.map((r) => (
                  <div
                    key={r.label}
                    style={{ top: r.y + 4, left: 12 }}
                    className="absolute font-mono font-bold text-xs text-slate-500 w-6 text-center select-none"
                  >
                    {r.label}
                  </div>
                ))}

                {/* Draggable Seats */}
                {layout.seats.map((seat) => {
                  const color = catColorMap.get(seat.category_id) || '#334155';
                  const selected = selectedSeatId === seat.id;
                  const isBlueprintBlocked =
                    layoutBlockedSet.has(seat.id) || seat.status === 'BLOCKED' || seat.status === 'DISABLED';
                  return (
                    <div
                      key={seat.id}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setSelectedSeatId(seat.id);
                        setSelectedAisleId(null);
                        dragRef.current = {
                          seatId: seat.id,
                          startClientX: e.clientX,
                          startClientY: e.clientY,
                          origX: seat.x,
                          origY: seat.y,
                        };
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        left: seat.x,
                        top: seat.y,
                        width: seat.width,
                        height: seat.height,
                        borderColor: selected ? '#7C3AED' : isBlueprintBlocked ? '#475569' : color,
                        backgroundColor: selected ? '#7C3AED' : isBlueprintBlocked ? '#64748B' : '#FFFFFF',
                        color: selected || isBlueprintBlocked ? '#FFFFFF' : '#0F172A',
                      }}
                      title={`${seat.id} (${seat.seat_type})${isBlueprintBlocked ? ' · Blocked in JSON' : ''}`}
                      className="absolute rounded-md border-2 flex items-center justify-center font-mono text-[10px] font-bold cursor-grab active:cursor-grabbing select-none"
                    >
                      {seat.id}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="text-center mt-2 text-[11px] font-display font-bold tracking-[0.2em] text-purple-700">
              SCREEN ({layout.screen_direction})
            </div>
          </div>

          {/* Right Inspector & Category Panel */}
          <div className="space-y-4">
            {/* Selected Seat Inspector */}
            {selectedSeat ? (
              <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <h3 className="font-display font-bold text-sm text-slate-950">Seat {selectedSeat.id}</h3>
                  <button
                    type="button"
                    onClick={handleDeleteSelected}
                    className="text-rose-600 hover:text-rose-700 font-semibold"
                  >
                    Remove
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-slate-500 mb-1">X (px)</label>
                    <input
                      type="number"
                      value={selectedSeat.x}
                      onChange={(e) =>
                        commitLayout({
                          ...layout,
                          seats: layout.seats.map((s) =>
                            s.id === selectedSeat.id ? { ...s, x: Number(e.target.value) } : s
                          ),
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500 mb-1">Y (px)</label>
                    <input
                      type="number"
                      value={selectedSeat.y}
                      onChange={(e) =>
                        commitLayout({
                          ...layout,
                          seats: layout.seats.map((s) =>
                            s.id === selectedSeat.id ? { ...s, y: Number(e.target.value) } : s
                          ),
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500 mb-1">Width</label>
                    <input
                      type="number"
                      min={20}
                      max={80}
                      value={selectedSeat.width}
                      onChange={(e) =>
                        commitLayout({
                          ...layout,
                          seats: layout.seats.map((s) =>
                            s.id === selectedSeat.id ? { ...s, width: Number(e.target.value) } : s
                          ),
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500 mb-1">Height</label>
                    <input
                      type="number"
                      min={20}
                      max={64}
                      value={selectedSeat.height}
                      onChange={(e) =>
                        commitLayout({
                          ...layout,
                          seats: layout.seats.map((s) =>
                            s.id === selectedSeat.id ? { ...s, height: Number(e.target.value) } : s
                          ),
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500 mb-1">Seat Type</label>
                    <select
                      value={selectedSeat.seat_type}
                      onChange={(e) =>
                        commitLayout({
                          ...layout,
                          seats: layout.seats.map((s) =>
                            s.id === selectedSeat.id ? { ...s, seat_type: e.target.value as SeatType } : s
                          ),
                        })
                      }
                      className="w-full px-2 py-1.5 rounded-lg border border-slate-200 bg-white"
                    >
                      {(['NORMAL', 'COUPLE', 'RECLINER', 'SOFA', 'WHEELCHAIR'] as SeatType[]).map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-500 mb-1">Block</label>
                    <select
                      value={selectedSeat.block}
                      onChange={(e) =>
                        commitLayout({
                          ...layout,
                          seats: layout.seats.map((s) =>
                            s.id === selectedSeat.id ? { ...s, block: e.target.value as SeatBlock } : s
                          ),
                        })
                      }
                      className="w-full px-2 py-1.5 rounded-lg border border-slate-200 bg-white"
                    >
                      {(['LEFT', 'CENTRE', 'RIGHT'] as SeatBlock[]).map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-slate-500 mb-1">Category</label>
                    <select
                      value={selectedSeat.category_id}
                      onChange={(e) =>
                        commitLayout({
                          ...layout,
                          seats: layout.seats.map((s) =>
                            s.id === selectedSeat.id ? { ...s, category_id: e.target.value } : s
                          ),
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                    >
                      {layout.categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} (₹{c.price})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-slate-500 mb-1">
                      Individual Seat Price Override (Priority 1, blank = use category)
                    </label>
                    <input
                      type="number"
                      min={0}
                      placeholder="Optional override ₹"
                      value={selectedSeat.price_override ?? ''}
                      onChange={(e) =>
                        commitLayout({
                          ...layout,
                          seats: layout.seats.map((s) =>
                            s.id === selectedSeat.id
                              ? { ...s, price_override: e.target.value === '' ? null : Number(e.target.value) }
                              : s
                          ),
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 font-mono"
                    />
                  </div>
                </div>
              </section>
            ) : selectedAisle ? (
              <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <h3 className="font-display font-bold text-sm text-slate-950">Aisle ({selectedAisle.orientation})</h3>
                  <button type="button" onClick={handleDeleteSelected} className="text-rose-600 font-semibold">
                    Delete
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(['x', 'y', 'width', 'height'] as const).map((field) => (
                    <div key={field}>
                      <label className="block text-slate-500 mb-1 uppercase">{field}</label>
                      <input
                        type="number"
                        value={selectedAisle[field]}
                        onChange={(e) =>
                          commitLayout({
                            ...layout,
                            aisles: layout.aisles.map((a) =>
                              a.id === selectedAisle.id ? { ...a, [field]: Number(e.target.value) } : a
                            ),
                          })
                        }
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 font-mono"
                      />
                    </div>
                  ))}
                </div>
              </section>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
                Click any seat or aisle on the canvas to edit coordinates, size, seat type, or individual price override.
              </div>
            )}

            {/* Category Manager */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-display font-bold text-sm text-slate-950">Seat Categories</h3>
                <button
                  type="button"
                  onClick={handleAddCategory}
                  className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
                >
                  + Add Category
                </button>
              </div>
              <div className="space-y-2.5">
                {layout.categories.map((cat) => {
                  const count = layout.seats.filter((s) => s.category_id === cat.id).length;
                  return (
                    <div key={cat.id} className="p-2.5 rounded-lg border border-slate-200 space-y-2 text-xs">
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={cat.color}
                          onChange={(e) => updateCategory(cat.id, { color: e.target.value })}
                          className="w-7 h-7 rounded border border-slate-200 cursor-pointer shrink-0"
                        />
                        <input
                          type="text"
                          value={cat.name}
                          onChange={(e) => updateCategory(cat.id, { name: e.target.value.toUpperCase() })}
                          className="flex-1 px-2 py-1 rounded border border-slate-200 font-semibold text-xs"
                        />
                        <input
                          type="number"
                          min={0}
                          value={cat.price}
                          onChange={(e) => updateCategory(cat.id, { price: Number(e.target.value) })}
                          className="w-20 px-2 py-1 rounded border border-slate-200 font-mono text-right"
                        />
                      </div>
                      <div className="text-[11px] text-slate-500 flex justify-between">
                        <span>Rows: {cat.rows.join(', ') || 'None'}</span>
                        <span className="font-mono">{count} seats</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Quick Row-to-Category Assigner */}
              <div className="pt-2 border-t border-slate-100 space-y-1.5">
                <div className="text-[11px] font-semibold text-slate-600">Assign Rows to Category</div>
                <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                  {layout.rows.map((r) => (
                    <div key={r.label} className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono font-bold text-slate-700 w-8">Row {r.label}</span>
                      <select
                        value={r.category_id}
                        onChange={(e) => assignRowToCategory(r.label, e.target.value)}
                        className="flex-1 px-2 py-1 rounded border border-slate-200 bg-white text-xs"
                      >
                        {layout.categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* Professional JSON File Upload, Validation & Preview Modal */}
      <JsonLayoutImportModal
        open={importModalOpen}
        activeScreen={activeScreen}
        onClose={() => setImportModalOpen(false)}
        onImported={(savedLayout, message) => {
          setLayout(savedLayout);
          setHistory([]);
          setFuture([]);
          setSelectedSeatId(null);
          setSelectedAisleId(null);
          setMsg({ type: 'ok', text: message });
          void loadScreens();
          onDataChanged();
        }}
      />
    </div>
  );
}
