import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileJson,
  FolderOpen,
  Minus,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { apiFetch } from '../../lib/api';
import {
  validateScreenLayoutJsonText,
  type DetailedLayoutValidationResult,
} from '../../lib/layoutJsonValidator';
import type { Screen, ScreenLayoutV2 } from '../../types';

interface JsonLayoutImportModalProps {
  open: boolean;
  activeScreen: Screen | null;
  onClose: () => void;
  onImported: (savedLayout: ScreenLayoutV2, message: string) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function JsonLayoutImportModal({
  open,
  activeScreen,
  onClose,
  onImported,
}: JsonLayoutImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    size: number;
    rawText: string;
  } | null>(null);
  const [uploadStatus, setUploadStatus] = useState<
    'IDLE' | 'LOADED' | 'VALIDATING' | 'VALID' | 'INVALID' | 'SAVING' | 'SAVED'
  >('IDLE');
  const [validation, setValidation] = useState<DetailedLayoutValidationResult | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(0.75);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!open || !activeScreen) return null;

  const resetAll = () => {
    setSelectedFile(null);
    setUploadStatus('IDLE');
    setValidation(null);
    setShowPreview(false);
    setSaveError(null);
    setSuccessMsg(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const runValidation = async (rawText: string) => {
    setUploadStatus('VALIDATING');
    setSaveError(null);
    setSuccessMsg(null);

    // Run server-side authoritative validation (falls back cleanly to identical shared validator if offline)
    try {
      const res = await apiFetch<DetailedLayoutValidationResult>(
        `/api/admin/screens/${activeScreen.id}/validate-layout`,
        {
          method: 'POST',
          body: JSON.stringify({ raw_json: rawText }),
        }
      );
      setValidation(res);
      setUploadStatus(res.valid ? 'VALID' : 'INVALID');
    } catch {
      // Server returns HTTP 400 with full JSON issues when invalid; re-run local shared line-numbered validator
      const localRes = validateScreenLayoutJsonText(rawText, { requireBlockedSeats: true });
      const warnings = [...localRes.warnings];
      if (localRes.valid && localRes.parsed) {
        if (localRes.parsed.screen_id !== activeScreen.id) {
          warnings.push(
            `Uploaded JSON screen_id "${localRes.parsed.screen_id}" differs from currently selected screen "${activeScreen.id}" (${activeScreen.name}). Only "${activeScreen.name}" will be updated; other theatre screens remain untouched.`
          );
        }
        if (localRes.parsed.theatre_id !== activeScreen.theatre_id) {
          warnings.push(
            `Uploaded JSON theatre_id "${localRes.parsed.theatre_id}" differs from target theatre "${activeScreen.theatre_id}". All uploaded JSON fields will be preserved verbatim.`
          );
        }
      }
      setValidation({ ...localRes, warnings });
      setUploadStatus(localRes.valid ? 'VALID' : 'INVALID');
    }
  };

  const handleFileObject = async (file: File) => {
    setSaveError(null);
    setSuccessMsg(null);
    setShowPreview(false);

    if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') {
      setSelectedFile({ name: file.name, size: file.size, rawText: '' });
      setValidation({
        valid: false,
        issues: [{ line: 1, field: 'file', message: 'Only .json files are supported for screen layout import.' }],
        errors: ['Line 1: Only .json files are supported for screen layout import.'],
        warnings: [],
      });
      setUploadStatus('INVALID');
      return;
    }

    const rawText = await file.text();
    setSelectedFile({ name: file.name, size: file.size, rawText });
    setUploadStatus('LOADED');
    await runValidation(rawText);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void handleFileObject(file);
    }
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleFileObject(file);
    }
  };

  const handleImportAndSave = async () => {
    if (!selectedFile || !validation?.valid || !validation.parsed) return;
    setUploadStatus('SAVING');
    setSaveError(null);
    try {
      const res = await apiFetch<{ message: string; capacity: number; layout: ScreenLayoutV2 }>(
        `/api/admin/screens/${activeScreen.id}/import-layout`,
        {
          method: 'POST',
          body: JSON.stringify({
            raw_json: selectedFile.rawText,
            filename: selectedFile.name,
          }),
        }
      );
      setUploadStatus('SAVED');
      setSuccessMsg(res.message);
      onImported(res.layout, res.message);
    } catch (err) {
      setUploadStatus('INVALID');
      setSaveError((err as Error).message);
    }
  };

  const previewLayout = validation?.valid ? validation.parsed : null;
  const blockedSet = new Set<string>(Array.isArray(previewLayout?.blocked_seats) ? previewLayout.blocked_seats : []);
  const catColorMap = new Map(previewLayout?.categories.map((c) => [c.id, c.color]) || []);

  const statusLabelMap: Record<typeof uploadStatus, { label: string; cls: string }> = {
    IDLE: { label: 'Waiting for JSON file', cls: 'text-slate-500 bg-slate-100' },
    LOADED: { label: 'File Loaded', cls: 'text-sky-700 bg-sky-50' },
    VALIDATING: { label: 'Validating JSON...', cls: 'text-amber-700 bg-amber-50' },
    VALID: { label: 'Validated — Ready to Save', cls: 'text-emerald-700 bg-emerald-50' },
    INVALID: { label: 'Validation Failed', cls: 'text-rose-700 bg-rose-50' },
    SAVING: { label: 'Saving to Database...', cls: 'text-sky-700 bg-sky-50' },
    SAVED: { label: 'Imported & Saved', cls: 'text-emerald-800 bg-emerald-100' },
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
      <div className="bg-white w-full max-w-4xl max-h-[92vh] rounded-2xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="font-display font-bold text-base sm:text-lg text-slate-950 truncate">
              Import Screen Layout JSON File (v2.0)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              Target Screen: <strong className="text-slate-800">{activeScreen.theatre_name} — {activeScreen.name}</strong> · Preserves exact coordinates without modifying your file
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              resetAll();
              onClose();
            }}
            aria-label="Close import modal"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* Hidden universal file input compatible with Android, iPhone, Windows & macOS */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileInputChange}
            className="hidden"
          />

          {/* Large Dashed Drag & Drop / Browse Upload Area */}
          {!selectedFile ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`rounded-2xl border-2 border-dashed p-8 sm:p-10 text-center cursor-pointer transition-colors ${
                dragActive
                  ? 'border-emerald-600 bg-emerald-50/70'
                  : 'border-slate-300 bg-slate-50/70 hover:border-emerald-500 hover:bg-emerald-50/30'
              }`}
            >
              <div className="w-14 h-14 mx-auto rounded-2xl bg-white border border-slate-200 shadow-xs flex items-center justify-center text-emerald-600 mb-3.5">
                <UploadCloud className="w-7 h-7" />
              </div>
              <div className="font-display font-bold text-base text-slate-950">
                Drop your TICKETNOW v2.0 .json layout file here
              </div>
              <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-lg mx-auto">
                Supports Android, iPhone, Windows PC &amp; desktop file browsers. Automatically checks syntax, schema version, IDs, coordinates, dimensions, <code className="font-mono text-slate-700">&quot;aisles&quot;: []</code>, and <code className="font-mono text-slate-700">&quot;blocked_seats&quot;: []</code>.
              </p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
                className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold"
              >
                <FolderOpen className="w-4 h-4 text-emerald-400" />
                Browse Files (.json)
              </button>
            </div>
          ) : (
            /* Selected File Metadata Card + Remove / Replace actions */
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              className={`rounded-2xl border-2 border-dashed p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                uploadStatus === 'VALID' || uploadStatus === 'SAVED'
                  ? 'border-emerald-300 bg-emerald-50/50'
                  : uploadStatus === 'INVALID'
                  ? 'border-rose-300 bg-rose-50/40'
                  : 'border-slate-300 bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                    uploadStatus === 'VALID' || uploadStatus === 'SAVED'
                      ? 'bg-emerald-600 text-white'
                      : uploadStatus === 'INVALID'
                      ? 'bg-rose-600 text-white'
                      : 'bg-slate-900 text-white'
                  }`}
                >
                  <FileJson className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-display font-bold text-sm text-slate-950 truncate">
                    {selectedFile.name}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 mt-0.5">
                    <span className="font-mono">{formatFileSize(selectedFile.size)}</span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={`px-2 py-0.5 rounded-md font-semibold text-[11px] ${statusLabelMap[uploadStatus].cls}`}
                    >
                      {statusLabelMap[uploadStatus].label}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Replace File
                </button>
                <button
                  type="button"
                  onClick={resetAll}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-rose-200 bg-white hover:bg-rose-50 text-xs font-semibold text-rose-700"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove File
                </button>
              </div>
            </div>
          )}

          {/* Save Success Banner */}
          {successMsg && (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="text-xs sm:text-sm text-emerald-950">
                <div className="font-display font-bold">Screen Layout Saved Successfully</div>
                <p className="mt-0.5 text-emerald-800">{successMsg}</p>
              </div>
            </div>
          )}

          {/* Save Error Banner */}
          {saveError && (
            <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="text-xs sm:text-sm text-rose-900">
                <div className="font-display font-bold">Import Error</div>
                <p className="mt-0.5">{saveError}</p>
              </div>
            </div>
          )}

          {/* Validation Result — Green Success Indicator + Blueprint Summary */}
          {validation?.valid && validation.summary && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 space-y-3">
              <div className="flex items-center gap-2 text-emerald-800 font-display font-bold text-sm">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                JSON Validation Passed — Exact Schema v{validation.summary.schema_version} Blueprint
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                <div className="rounded-lg bg-white border border-emerald-100 p-2.5">
                  <div className="text-slate-500">Theatre / Screen ID</div>
                  <div className="font-mono font-semibold text-slate-900 truncate mt-0.5">
                    {validation.summary.theatre_id} / {validation.summary.screen_id}
                  </div>
                </div>
                <div className="rounded-lg bg-white border border-emerald-100 p-2.5">
                  <div className="text-slate-500">Canvas Dimensions</div>
                  <div className="font-mono font-semibold text-slate-900 mt-0.5">
                    {validation.summary.dimensions}
                  </div>
                </div>
                <div className="rounded-lg bg-white border border-emerald-100 p-2.5">
                  <div className="text-slate-500">Seats / Rows / Tiers</div>
                  <div className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                    {validation.summary.seats_count} seats · {validation.summary.rows_count} rows ·{' '}
                    {validation.summary.categories_count} cats
                  </div>
                </div>
                <div className="rounded-lg bg-white border border-emerald-100 p-2.5">
                  <div className="text-slate-500">Aisles / Blocked</div>
                  <div className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                    {validation.summary.aisles_count} aisles · {validation.summary.blocked_seats_count} blocked
                  </div>
                </div>
              </div>

              {validation.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1">
                  {validation.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-amber-900">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Validation Result — Red Error Indicator with Line Numbers & Descriptions */}
          {validation && !validation.valid && validation.issues.length > 0 && (
            <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-rose-800 font-display font-bold text-sm">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  Validation Failed ({validation.issues.length} issue{validation.issues.length > 1 ? 's' : ''})
                </div>
                <span className="text-[11px] font-medium text-rose-700">
                  Uploaded file is never modified silently — fix errors and re-upload
                </span>
              </div>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-rose-200 bg-white divide-y divide-rose-100">
                {validation.issues.map((issue, idx) => (
                  <div key={idx} className="px-3 py-2 flex items-start gap-3 text-xs">
                    <span className="font-mono font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded shrink-0 tabular-nums">
                      Line {issue.line}
                    </span>
                    <div className="min-w-0">
                      <span className="font-mono font-semibold text-slate-800 mr-1.5">{issue.field}:</span>
                      <span className="text-slate-700">{issue.message}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Exact-Coordinate Screen Layout Preview */}
          {showPreview && previewLayout && (
            <div className="rounded-xl border border-slate-200 bg-slate-100 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-slate-800">
                  Import Preview — Exact JSON Coordinates ({previewLayout.screen_name} · {previewLayout.seats.length} seats)
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPreviewZoom((z) => Math.max(0.45, Math.round((z - 0.1) * 100) / 100))}
                    className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50"
                    aria-label="Zoom out preview"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="font-mono text-xs w-10 text-center tabular-nums">
                    {Math.round(previewZoom * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setPreviewZoom((z) => Math.min(1.2, Math.round((z + 0.1) * 100) / 100))}
                    className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50"
                    aria-label="Zoom in preview"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Category legend */}
              <div className="flex flex-wrap items-center gap-3 text-[11px]">
                {previewLayout.categories.map((cat) => (
                  <span key={cat.id} className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                    <span className="w-3 h-3 rounded-xs border-2 bg-white" style={{ borderColor: cat.color }} />
                    {cat.name} (₹{cat.price})
                  </span>
                ))}
                {blockedSet.size > 0 && (
                  <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                    <span className="w-3 h-3 rounded-xs bg-slate-600" />
                    Blocked ({blockedSet.size})
                  </span>
                )}
              </div>

              <div className="overflow-auto rounded-xl border border-slate-300 bg-white p-3">
                {previewLayout.screen_direction === 'TOP' && (
                  <div className="text-center mb-3 text-[11px] font-display font-bold tracking-[0.2em] text-purple-700">
                    SCREEN THIS WAY (TOP)
                  </div>
                )}
                <div
                  className="relative mx-auto"
                  style={{
                    width: Math.round(previewLayout.screen_width * previewZoom),
                    height: Math.round(previewLayout.screen_height * previewZoom),
                  }}
                >
                  <div
                    className="relative origin-top-left"
                    style={{
                      width: previewLayout.screen_width,
                      height: previewLayout.screen_height,
                      transform: `scale(${previewZoom})`,
                    }}
                  >
                    {previewLayout.aisles.map((a) => (
                      <div
                        key={a.id}
                        style={{ left: a.x, top: a.y, width: a.width, height: a.height }}
                        className="absolute border border-dashed border-slate-300 bg-slate-100/60 flex items-center justify-center text-[10px] font-mono text-slate-400"
                      >
                        {a.orientation === 'horizontal' ? a.label || 'Walkway' : ''}
                      </div>
                    ))}
                    {previewLayout.rows.map((r) => (
                      <div
                        key={r.label}
                        style={{ top: r.y + 4, left: 12 }}
                        className="absolute font-mono font-bold text-xs text-slate-500 w-6 text-center"
                      >
                        {r.label}
                      </div>
                    ))}
                    {previewLayout.seats.map((seat) => {
                      const isBlocked =
                        blockedSet.has(seat.id) || seat.status === 'BLOCKED' || seat.status === 'DISABLED';
                      const color = catColorMap.get(seat.category_id) || '#334155';
                      return (
                        <div
                          key={seat.id}
                          style={{
                            left: seat.x,
                            top: seat.y,
                            width: seat.width,
                            height: seat.height,
                            borderColor: isBlocked ? '#475569' : color,
                            backgroundColor: isBlocked ? '#475569' : '#FFFFFF',
                            color: isBlocked ? '#FFFFFF' : '#0F172A',
                          }}
                          title={`${seat.id} · ${seat.seat_type}${isBlocked ? ' · BLOCKED' : ''}`}
                          className="absolute rounded-md border-2 flex items-center justify-center font-mono text-[10px] font-bold select-none"
                        >
                          {seat.id}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {previewLayout.screen_direction === 'BOTTOM' && (
                  <div className="text-center mt-3 text-[11px] font-display font-bold tracking-[0.2em] text-purple-700">
                    SCREEN THIS WAY (BOTTOM)
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer — 4 Explicit Import Actions */}
        <div className="px-4 sm:px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!selectedFile || uploadStatus === 'VALIDATING' || uploadStatus === 'SAVING'}
              onClick={() => selectedFile && void runValidation(selectedFile.rawText)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-900 disabled:opacity-40"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Validate JSON
            </button>
            <button
              type="button"
              disabled={!validation?.valid}
              onClick={() => setShowPreview((p) => !p)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold disabled:opacity-40 ${
                showPreview
                  ? 'border-purple-600 bg-purple-600 text-white'
                  : 'border-slate-300 bg-white hover:bg-slate-100 text-slate-900'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              {showPreview ? 'Hide Preview' : 'Preview Screen Layout'}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                resetAll();
                onClose();
              }}
              className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!validation?.valid || uploadStatus === 'SAVING' || uploadStatus === 'SAVED'}
              onClick={handleImportAndSave}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-40"
            >
              <Save className="w-3.5 h-3.5" />
              {uploadStatus === 'SAVING'
                ? 'Importing...'
                : uploadStatus === 'SAVED'
                ? 'Saved!'
                : 'Import & Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
