import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  Minus,
  MousePointerClick,
  Plus,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  Wand2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api';
import {
  runAutoSeatSelection,
  summarizeSeatSelection,
  type AutoSelectMode,
  type RowZonePreference,
} from '../../lib/autoSeatSelector';
import { downloadSampleCustomerCsv, parseCustomerFile } from '../../lib/bulkTicketPdf';
import { formatDateChip, formatINR } from '../../lib/format';
import type {
  BulkBookingRecord,
  BulkCustomerAssignment,
  Movie,
  ResolvedSeat,
  Screen,
  Show,
  ShowSeatMapResponse,
  Theatre,
} from '../../types';
import { BulkTicketConfirmationModal } from './BulkTicketConfirmationModal';

interface AdminBulkBookingProps {
  onDataChanged: () => void;
  onOpenHistory: () => void;
}

interface DragRect {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export function AdminBulkBooking({ onDataChanged, onOpenHistory }: AdminBulkBookingProps) {
  // Master catalog for cascading selectors
  const [theatres, setTheatres] = useState<Theatre[]>([]);
  const [screens, setScreens] = useState<Screen[]>([]);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [shows, setShows] = useState<Show[]>([]);
  const [loadingInit, setLoadingInit] = useState(true);

  // Cascading booking selectors
  const [selectedTheatreId, setSelectedTheatreId] = useState('');
  const [selectedScreenId, setSelectedScreenId] = useState('');
  const [selectedMovieId, setSelectedMovieId] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedShowId, setSelectedShowId] = useState('');

  // Active show seat map
  const [seatMap, setSeatMap] = useState<ShowSeatMapResponse | null>(null);
  const [loadingMap, setLoadingMap] = useState(false);
  const [zoom, setZoom] = useState(0.85);

  // Selection state (separating manual vs auto so we NEVER silently overwrite manual seats!)
  const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>([]);
  const [selectionSource, setSelectionSource] = useState<'NONE' | 'MANUAL' | 'AUTO' | 'MIXED'>('NONE');
  const [manualSeatIds, setManualSeatIds] = useState<Set<string>>(new Set());

  // Quantity-Based Automatic Seat Selection state
  const [autoMode, setAutoMode] = useState<AutoSelectMode>('MIXED');
  const [requestedQtyInput, setRequestedQtyInput] = useState<string>('10');
  const [categoryQuantities, setCategoryQuantities] = useState<Record<string, string>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sameRowPriority, setSameRowPriority] = useState(true);
  const [adjacentSeatsPriority, setAdjacentSeatsPriority] = useState(true);
  const [centreSeatsPriority, setCentreSeatsPriority] = useState(true);
  const [rowZone, setRowZone] = useState<RowZonePreference>('ANY');
  const [specificCategoryId, setSpecificCategoryId] = useState('ALL');
  const [allowMultipleRows, setAllowMultipleRows] = useState(true);
  const [candidateOffset, setCandidateOffset] = useState(0);
  const [candidateCount, setCandidateCount] = useState(0);
  const [autoError, setAutoError] = useState<string | null>(null);
  const [autoInfo, setAutoInfo] = useState<string | null>(null);
  const [pendingOverwriteConfirm, setPendingOverwriteConfirm] = useState<{
    nextOffset: number;
  } | null>(null);

  // Drag marquee selection on canvas
  const canvasInnerRef = useRef<HTMLDivElement | null>(null);
  const seatCanvasSectionRef = useRef<HTMLDivElement | null>(null);
  const [dragRect, setDragRect] = useState<DragRect | null>(null);

  // Customer Details (Mode A / Mode B)
  const [customerMode, setCustomerMode] = useState<'SINGLE_CUSTOMER' | 'MULTIPLE_CUSTOMERS'>('SINGLE_CUSTOMER');
  const [singleName, setSingleName] = useState('');
  const [singleMobile, setSingleMobile] = useState('');
  const [singleEmail, setSingleEmail] = useState('');
  const [referenceCode, setReferenceCode] = useState('');

  const [multiCustomers, setMultiCustomers] = useState<BulkCustomerAssignment[]>([
    { id: 'cust_init_1', name: '', mobile: '', email: '', seat_ids: [] },
  ]);
  const [csvImportMsg, setCsvImportMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const customerFileRef = useRef<HTMLInputElement | null>(null);

  // Financial adjustments
  const [convenienceFeePerSeat, setConvenienceFeePerSeat] = useState<number>(15);
  const [discountType, setDiscountType] = useState<'FLAT' | 'PERCENT'>('FLAT');
  const [discountInput, setDiscountInput] = useState<string>('0');
  const [applyTax, setApplyTax] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<string>('Corporate Invoice');

  // Submission & confirmation
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [unavailableSeatsAlert, setUnavailableSeatsAlert] = useState<
    Array<{ seat_id: string; reason: string }>
  >([]);
  const [confirmedBulk, setConfirmedBulk] = useState<BulkBookingRecord | null>(null);
  const [txIdempotencyKey, setTxIdempotencyKey] = useState<string>('');

  // Load initial theatres, screens, movies, shows
  useEffect(() => {
    let active = true;
    setLoadingInit(true);
    Promise.all([
      apiFetch<{ theatres: Theatre[] }>('/api/admin/theatres'),
      apiFetch<{ screens: Screen[] }>('/api/admin/screens'),
      apiFetch<{ movies: Movie[] }>('/api/admin/movies'),
      apiFetch<{ shows: Show[] }>('/api/admin/shows'),
    ])
      .then(([th, sc, mov, sh]) => {
        if (!active) return;
        const activeShows = sh.shows.filter((s) => s.status === 'ACTIVE');
        setTheatres(th.theatres);
        setScreens(sc.screens);
        setMovies(mov.movies);
        setShows(activeShows);

        if (activeShows.length > 0) {
          const first = activeShows[0];
          setSelectedTheatreId(first.theatre_id);
          setSelectedScreenId(first.screen_id);
          setSelectedMovieId(first.movie_id);
          setSelectedDate(first.show_date);
          setSelectedShowId(first.id);
        }
      })
      .finally(() => {
        if (active) setLoadingInit(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Derived cascading filter options
  const filteredScreens = useMemo(
    () => (selectedTheatreId ? screens.filter((s) => s.theatre_id === selectedTheatreId) : screens),
    [screens, selectedTheatreId]
  );

  const showsForTheatreScreen = useMemo(
    () =>
      shows.filter(
        (s) =>
          (!selectedTheatreId || s.theatre_id === selectedTheatreId) &&
          (!selectedScreenId || s.screen_id === selectedScreenId)
      ),
    [shows, selectedTheatreId, selectedScreenId]
  );

  const availableMovieIds = useMemo(
    () => new Set(showsForTheatreScreen.map((s) => s.movie_id)),
    [showsForTheatreScreen]
  );

  const filteredMovies = useMemo(
    () => movies.filter((m) => availableMovieIds.has(m.id)),
    [movies, availableMovieIds]
  );

  const showsForMovie = useMemo(
    () =>
      showsForTheatreScreen.filter((s) => (!selectedMovieId ? true : s.movie_id === selectedMovieId)),
    [showsForTheatreScreen, selectedMovieId]
  );

  const availableDates = useMemo(
    () => Array.from(new Set(showsForMovie.map((s) => s.show_date))).sort(),
    [showsForMovie]
  );

  const filteredShows = useMemo(
    () => showsForMovie.filter((s) => (!selectedDate ? true : s.show_date === selectedDate)),
    [showsForMovie, selectedDate]
  );

  // Keep cascading dropdowns consistent whenever parent selection changes
  const handleTheatreChange = (tid: string) => {
    setSelectedTheatreId(tid);
    const matchingScreens = screens.filter((s) => s.theatre_id === tid);
    const nextScreenId = matchingScreens[0]?.id || '';
    setSelectedScreenId(nextScreenId);
    const matchingShows = shows.filter((s) => s.theatre_id === tid && (!nextScreenId || s.screen_id === nextScreenId));
    const first = matchingShows[0];
    setSelectedMovieId(first?.movie_id || '');
    setSelectedDate(first?.show_date || '');
    setSelectedShowId(first?.id || '');
  };

  const handleScreenChange = (sid: string) => {
    setSelectedScreenId(sid);
    const matchingShows = shows.filter(
      (s) => (!selectedTheatreId || s.theatre_id === selectedTheatreId) && (!sid || s.screen_id === sid)
    );
    const first = matchingShows[0];
    setSelectedMovieId(first?.movie_id || '');
    setSelectedDate(first?.show_date || '');
    setSelectedShowId(first?.id || '');
  };

  const handleMovieChange = (mid: string) => {
    setSelectedMovieId(mid);
    const matchingShows = showsForTheatreScreen.filter((s) => !mid || s.movie_id === mid);
    const first = matchingShows[0];
    setSelectedDate(first?.show_date || '');
    setSelectedShowId(first?.id || '');
  };

  const handleDateChange = (dt: string) => {
    setSelectedDate(dt);
    const matchingShows = showsForMovie.filter((s) => !dt || s.show_date === dt);
    setSelectedShowId(matchingShows[0]?.id || '');
  };

  // Fetch live seat map whenever selectedShowId changes
  const loadSeatMap = useCallback(async (showId: string, clearSelection = true) => {
    if (!showId) {
      setSeatMap(null);
      return;
    }
    setLoadingMap(true);
    setSubmitError(null);
    setUnavailableSeatsAlert([]);
    try {
      const res = await apiFetch<ShowSeatMapResponse>(`/api/shows/${showId}/seat-map`);
      setSeatMap(res);
      setConvenienceFeePerSeat(res.settings.convenience_fee_per_seat);
      if (clearSelection) {
        setSelectedSeatIds([]);
        setManualSeatIds(new Set());
        setSelectionSource('NONE');
        setAutoError(null);
        setAutoInfo(null);
        setCandidateOffset(0);
        setCandidateCount(0);
        setCategoryQuantities(
          Object.fromEntries(res.categories.map((c) => [c.id, '0']))
        );
        setMultiCustomers((prev) => prev.map((c) => ({ ...c, seat_ids: [] })));
      }
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setLoadingMap(false);
    }
  }, []);

  useEffect(() => {
    if (selectedShowId) {
      void loadSeatMap(selectedShowId, true);
    } else {
      setSeatMap(null);
    }
  }, [selectedShowId, loadSeatMap]);

  // Derived seat sets and maps
  const seatById = useMemo(
    () => new Map<string, ResolvedSeat>((seatMap?.seats || []).map((s) => [s.id, s])),
    [seatMap]
  );

  const availableSeats = useMemo(
    () => (seatMap?.seats || []).filter((s) => s.status === 'AVAILABLE'),
    [seatMap]
  );

  const selectedSet = useMemo(() => new Set(selectedSeatIds), [selectedSeatIds]);

  const selectedSeatObjects = useMemo(
    () =>
      selectedSeatIds
        .map((id) => seatById.get(id))
        .filter((s): s is ResolvedSeat => Boolean(s && s.status === 'AVAILABLE')),
    [selectedSeatIds, seatById]
  );

  const requestedTotalQuantity = useMemo(() => {
    if (autoMode === 'CATEGORY') {
      const sum = Object.values(categoryQuantities).reduce(
        (acc, v) => acc + Math.max(0, Math.floor(Number(v) || 0)),
        0
      );
      return sum > 0 ? sum : Math.max(0, Math.floor(Number(requestedQtyInput) || 0));
    }
    return Math.max(0, Math.floor(Number(requestedQtyInput) || 0));
  }, [autoMode, categoryQuantities, requestedQtyInput]);

  const liveSummary = useMemo(
    () => summarizeSeatSelection(selectedSeatObjects, availableSeats.length, requestedTotalQuantity),
    [selectedSeatObjects, availableSeats.length, requestedTotalQuantity]
  );

  // Sync multi-customer assignments whenever selectedSeatIds shrinks (remove deselected seats cleanly)
  useEffect(() => {
    setMultiCustomers((prev) =>
      prev.map((c) => ({
        ...c,
        seat_ids: c.seat_ids.filter((id) => selectedSet.has(id)),
      }))
    );
  }, [selectedSet]);

  // Financial calculation
  const financials = useMemo(() => {
    const subtotal = liveSummary.totalPrice;
    const rawDiscount = Math.max(0, Number(discountInput) || 0);
    const discount =
      discountType === 'PERCENT'
        ? Math.min(subtotal, Math.round(subtotal * (Math.min(100, rawDiscount) / 100) * 100) / 100)
        : Math.min(subtotal, Math.round(rawDiscount * 100) / 100);
    const convFee = Math.round(selectedSeatObjects.length * Math.max(0, convenienceFeePerSeat) * 100) / 100;
    const taxRate = seatMap?.settings.tax_rate_percent ?? 18;
    const tax = applyTax ? Math.round(convFee * (taxRate / 100) * 100) / 100 : 0;
    const total = Math.round((subtotal - discount + convFee + tax) * 100) / 100;
    return { subtotal, discount, convFee, tax, taxRate, total };
  }, [liveSummary.totalPrice, discountInput, discountType, selectedSeatObjects.length, convenienceFeePerSeat, applyTax, seatMap]);

  // Core Auto-Selection Executor
  const executeAutoSelect = useCallback(
    (
      offset: number,
      strategy: 'REPLACE' | 'KEEP_MANUAL' = 'REPLACE',
      overrideQty?: string,
      overrideCatQtys?: Record<string, string>
    ) => {
      if (!seatMap) return;
      setAutoError(null);
      setAutoInfo(null);

      const qtySource = overrideQty !== undefined ? overrideQty : requestedQtyInput;
      const catSource = overrideCatQtys !== undefined ? overrideCatQtys : categoryQuantities;

      const numericCatMap: Record<string, number> = {};
      for (const [k, v] of Object.entries(catSource)) {
        const n = Math.floor(Number(v) || 0);
        if (n > 0) numericCatMap[k] = n;
      }

      const keepIds = strategy === 'KEEP_MANUAL' ? Array.from(manualSeatIds) : [];
      const excludeSet = new Set(keepIds);

      let totalQty = Math.floor(Number(qtySource) || 0);
      if (strategy === 'KEEP_MANUAL' && autoMode === 'MIXED') {
        totalQty = Math.max(0, totalQty - keepIds.length);
        if (totalQty === 0) {
          setAutoInfo(`Your ${keepIds.length} manually selected seat(s) already fulfill the requested quantity.`);
          return;
        }
      }

      const res = runAutoSeatSelection(seatMap.seats, seatMap.layout, {
        mode: autoMode,
        totalQuantity: totalQty,
        categoryQuantities: autoMode === 'CATEGORY' ? numericCatMap : undefined,
        sameRowPriority,
        adjacentSeatsPriority,
        centreSeatsPriority,
        rowZone,
        specificCategoryId,
        allowMultipleRows,
        excludeSeatIds: excludeSet,
        candidateOffset: offset,
      });

      if (!res.ok) {
        setAutoError(res.error || 'Unable to auto-select seats.');
        if (strategy === 'REPLACE') {
          setSelectedSeatIds([]);
          setManualSeatIds(new Set());
          setSelectionSource('NONE');
        }
        return;
      }

      const finalIds = Array.from(new Set([...keepIds, ...res.selectedSeats.map((s) => s.id)]));
      setSelectedSeatIds(finalIds);
      if (strategy === 'REPLACE') {
        setManualSeatIds(new Set());
        setSelectionSource('AUTO');
      } else {
        setSelectionSource('MIXED');
      }
      setCandidateOffset(res.appliedCandidateIndex);
      setCandidateCount(res.candidateCount);
      setAutoInfo(
        `Auto-selected ${res.selectedSeats.length} seat${res.selectedSeats.length > 1 ? 's' : ''} across row${
          res.selectedRows.length > 1 ? 's' : ''
        } ${res.selectedRows.join(', ')}.`
      );
    },
    [
      seatMap,
      requestedQtyInput,
      categoryQuantities,
      manualSeatIds,
      autoMode,
      sameRowPriority,
      adjacentSeatsPriority,
      centreSeatsPriority,
      rowZone,
      specificCategoryId,
      allowMultipleRows,
    ]
  );

  // Guarded trigger that prompts before overwriting manually selected seats
  const triggerAutoSelect = (nextOffset = 0) => {
    if (manualSeatIds.size > 0) {
      setPendingOverwriteConfirm({ nextOffset });
      return;
    }
    executeAutoSelect(nextOffset, 'REPLACE');
  };

  // Auto-recalculate cleanly when quantity changes ONLY when current selection is pure AUTO (never silently clobbers MANUAL!)
  const handleMixedQtyChange = (val: string) => {
    setRequestedQtyInput(val);
    setAutoError(null);
    if (selectionSource === 'AUTO' && manualSeatIds.size === 0 && seatMap) {
      const n = Math.floor(Number(val) || 0);
      if (n > 0) {
        executeAutoSelect(0, 'REPLACE', val);
      } else {
        setSelectedSeatIds([]);
        setSelectionSource('NONE');
      }
    }
  };

  const handleCategoryQtyChange = (catId: string, val: string) => {
    const nextMap = { ...categoryQuantities, [catId]: val };
    setCategoryQuantities(nextMap);
    setAutoError(null);
    if (selectionSource === 'AUTO' && manualSeatIds.size === 0 && seatMap) {
      const total = Object.values(nextMap).reduce((s, v) => s + Math.max(0, Math.floor(Number(v) || 0)), 0);
      if (total > 0) {
        executeAutoSelect(0, 'REPLACE', undefined, nextMap);
      } else {
        setSelectedSeatIds([]);
        setSelectionSource('NONE');
      }
    }
  };

  // Manual Seat / Row / Category / All toggle handlers
  const toggleSingleSeat = (seat: ResolvedSeat) => {
    if (seat.status !== 'AVAILABLE') return;
    setAutoError(null);
    setAutoInfo(null);
    setSelectedSeatIds((prev) => {
      const exists = prev.includes(seat.id);
      const next = exists ? prev.filter((id) => id !== seat.id) : [...prev, seat.id];
      setManualSeatIds((m) => {
        const nm = new Set(m);
        if (exists) nm.delete(seat.id);
        else nm.add(seat.id);
        return nm;
      });
      setSelectionSource(next.length === 0 ? 'NONE' : selectionSource === 'AUTO' ? 'MIXED' : 'MANUAL');
      return next;
    });
  };

  const toggleRowSeats = (rowLabel: string) => {
    if (!seatMap) return;
    const rowAvail = seatMap.seats.filter((s) => s.row === rowLabel && s.status === 'AVAILABLE').map((s) => s.id);
    if (rowAvail.length === 0) return;
    const allSelected = rowAvail.every((id) => selectedSet.has(id));

    setSelectedSeatIds((prev) => {
      const nextSet = new Set(prev);
      if (allSelected) {
        rowAvail.forEach((id) => nextSet.delete(id));
      } else {
        rowAvail.forEach((id) => nextSet.add(id));
      }
      const arr = Array.from(nextSet);
      setManualSeatIds(new Set(arr));
      setSelectionSource(arr.length === 0 ? 'NONE' : 'MANUAL');
      return arr;
    });
    setAutoError(null);
    setAutoInfo(null);
  };

  const toggleCategorySeats = (categoryId: string) => {
    if (!seatMap) return;
    const catAvail = seatMap.seats
      .filter((s) => s.category_id === categoryId && s.status === 'AVAILABLE')
      .map((s) => s.id);
    if (catAvail.length === 0) return;
    const allSelected = catAvail.every((id) => selectedSet.has(id));

    setSelectedSeatIds((prev) => {
      const nextSet = new Set(prev);
      if (allSelected) {
        catAvail.forEach((id) => nextSet.delete(id));
      } else {
        catAvail.forEach((id) => nextSet.add(id));
      }
      const arr = Array.from(nextSet);
      setManualSeatIds(new Set(arr));
      setSelectionSource(arr.length === 0 ? 'NONE' : 'MANUAL');
      return arr;
    });
    setAutoError(null);
    setAutoInfo(null);
  };

  const handleSelectAllAvailable = () => {
    const ids = availableSeats.map((s) => s.id);
    setSelectedSeatIds(ids);
    setManualSeatIds(new Set(ids));
    setSelectionSource(ids.length > 0 ? 'MANUAL' : 'NONE');
    setAutoError(null);
    setAutoInfo(`Selected all ${ids.length} available seats.`);
  };

  const handleClearSelection = () => {
    setSelectedSeatIds([]);
    setManualSeatIds(new Set());
    setSelectionSource('NONE');
    setAutoError(null);
    setAutoInfo(null);
    setCandidateOffset(0);
    setCandidateCount(0);
    setMultiCustomers((prev) => prev.map((c) => ({ ...c, seat_ids: [] })));
  };

  // Drag-selection marquee handlers on coordinate canvas
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !canvasInnerRef.current) return;
    const target = e.target as HTMLElement;
    if (target.closest('button[data-seat-btn="true"]') || target.closest('button[data-row-btn="true"]')) {
      return;
    }
    const rect = canvasInnerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    setDragRect({ startX: x, startY: y, currentX: x, currentY: y });
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragRect || !canvasInnerRef.current) return;
    const rect = canvasInnerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    setDragRect((prev) => (prev ? { ...prev, currentX: x, currentY: y } : null));
  };

  const finishDragSelection = () => {
    if (!dragRect || !seatMap) {
      setDragRect(null);
      return;
    }
    const minX = Math.min(dragRect.startX, dragRect.currentX);
    const maxX = Math.max(dragRect.startX, dragRect.currentX);
    const minY = Math.min(dragRect.startY, dragRect.currentY);
    const maxY = Math.max(dragRect.startY, dragRect.currentY);

    if (maxX - minX > 8 || maxY - minY > 8) {
      const hitIds = seatMap.seats
        .filter(
          (s) =>
            s.status === 'AVAILABLE' &&
            s.x + s.width >= minX &&
            s.x <= maxX &&
            s.y + s.height >= minY &&
            s.y <= maxY
        )
        .map((s) => s.id);

      if (hitIds.length > 0) {
        setSelectedSeatIds((prev) => {
          const merged = Array.from(new Set([...prev, ...hitIds]));
          setManualSeatIds(new Set(merged));
          setSelectionSource('MANUAL');
          return merged;
        });
        setAutoInfo(`Drag-selected ${hitIds.length} available seat${hitIds.length > 1 ? 's' : ''}.`);
      }
    }
    setDragRect(null);
  };

  // Multi-customer helpers
  const assignedSeatOwnerMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of multiCustomers) {
      for (const sid of c.seat_ids) {
        map.set(sid, c.id);
      }
    }
    return map;
  }, [multiCustomers]);

  const unassignedSeatIds = useMemo(
    () => selectedSeatIds.filter((id) => !assignedSeatOwnerMap.has(id)),
    [selectedSeatIds, assignedSeatOwnerMap]
  );

  const handleAddCustomerRow = () => {
    setMultiCustomers((prev) => [
      ...prev,
      { id: `cust_${Date.now().toString(36)}_${prev.length}`, name: '', mobile: '', email: '', seat_ids: [] },
    ]);
  };

  const handleRemoveCustomerRow = (id: string) => {
    setMultiCustomers((prev) => (prev.length <= 1 ? prev : prev.filter((c) => c.id !== id)));
  };

  const handleToggleSeatForCustomer = (custId: string, seatId: string) => {
    setMultiCustomers((prev) =>
      prev.map((c) => {
        if (c.id === custId) {
          const exists = c.seat_ids.includes(seatId);
          return {
            ...c,
            seat_ids: exists ? c.seat_ids.filter((id) => id !== seatId) : [...c.seat_ids, seatId],
          };
        }
        // Remove seat from any other customer if reassigned
        return {
          ...c,
          seat_ids: c.seat_ids.filter((id) => id !== seatId),
        };
      })
    );
  };

  const handleAutoDistributeSeats = () => {
    if (multiCustomers.length === 0 || selectedSeatIds.length === 0) return;
    const buckets: string[][] = multiCustomers.map(() => []);
    selectedSeatIds.forEach((seatId, idx) => {
      buckets[idx % multiCustomers.length].push(seatId);
    });
    setMultiCustomers((prev) => prev.map((c, idx) => ({ ...c, seat_ids: buckets[idx] })));
  };

  const handleCustomerCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCsvImportMsg(null);
    try {
      const { customers, errors } = await parseCustomerFile(file, selectedSeatIds);
      if (customers.length > 0) {
        setMultiCustomers(customers);
      }
      if (errors.length > 0) {
        setCsvImportMsg({
          type: 'err',
          text: `Imported ${customers.length} customer(s) with ${errors.length} issue(s): ${errors.slice(0, 3).join(' | ')}`,
        });
      } else {
        setCsvImportMsg({
          type: 'ok',
          text: `Imported ${customers.length} customer record(s) from "${file.name}".`,
        });
      }
    } catch (err) {
      setCsvImportMsg({ type: 'err', text: `Failed to parse file: ${(err as Error).message}` });
    }
  };

  // Validate customer details before opening Confirm Dialog
  const validateBeforeConfirm = (): string | null => {
    if (!selectedShowId || !seatMap) return 'Please select a Theatre, Screen, Movie, Date, and Show Time.';
    if (selectedSeatObjects.length === 0) return 'Please select at least 1 available seat.';

    if (customerMode === 'SINGLE_CUSTOMER') {
      if (!singleName.trim()) return 'Customer Name is required.';
      if (singleMobile.replace(/\D/g, '').length < 10) return 'Please enter a valid 10-digit Mobile Number.';
      if (singleEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(singleEmail.trim())) {
        return 'Please enter a valid Email address (or leave it blank).';
      }
      return null;
    }

    if (multiCustomers.length === 0) return 'Add at least one customer record.';
    for (let i = 0; i < multiCustomers.length; i++) {
      const c = multiCustomers[i];
      if (!c.name.trim()) return `Customer #${i + 1}: Name is required.`;
      if (c.mobile.replace(/\D/g, '').length < 10) return `Customer "${c.name}": Valid 10-digit Mobile Number is required.`;
      if (c.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) {
        return `Customer "${c.name}": Invalid email address.`;
      }
      if (c.seat_ids.length === 0) return `Customer "${c.name}" must have at least 1 seat assigned.`;
    }
    if (unassignedSeatIds.length > 0) {
      return `${unassignedSeatIds.length} selected seat(s) are not yet assigned to a customer (${unassignedSeatIds
        .slice(0, 8)
        .join(', ')}). Assign all selected seats or click "Auto-Distribute".`;
    }
    return null;
  };

  const handleOpenConfirmDialog = () => {
    setSubmitError(null);
    setUnavailableSeatsAlert([]);
    const err = validateBeforeConfirm();
    if (err) {
      setSubmitError(err);
      return;
    }
    setTxIdempotencyKey(`blk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
    setConfirmDialogOpen(true);
  };

  const handleCommitBulkBooking = async () => {
    if (!selectedShowId || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setUnavailableSeatsAlert([]);

    const customersPayload =
      customerMode === 'SINGLE_CUSTOMER'
        ? [
            {
              name: singleName.trim(),
              mobile: singleMobile.trim(),
              email: singleEmail.trim(),
              seat_ids: selectedSeatObjects.map((s) => s.id),
            },
          ]
        : multiCustomers.map((c) => ({
            name: c.name.trim(),
            mobile: c.mobile.trim(),
            email: c.email.trim(),
            seat_ids: c.seat_ids,
          }));

    try {
      const token = localStorage.getItem('ticketnow_auth_token') || '';
      const response = await fetch('/api/admin/bulk-bookings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          show_id: selectedShowId,
          mode: customerMode,
          reference_code: referenceCode.trim(),
          idempotency_key: txIdempotencyKey,
          payment_method: paymentMethod,
          convenience_fee_per_seat: convenienceFeePerSeat,
          discount_amount: financials.discount,
          apply_tax: applyTax,
          customers: customersPayload,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        unavailable_seats?: Array<{ seat_id: string; reason: string }>;
        bulk_booking?: BulkBookingRecord;
      };

      if (!response.ok) {
        setConfirmDialogOpen(false);
        if (data.unavailable_seats && data.unavailable_seats.length > 0) {
          setUnavailableSeatsAlert(data.unavailable_seats);
        }
        setSubmitError(data.error || 'Bulk booking could not be completed.');
        // Refresh seat map immediately so newly occupied/locked seats appear right away
        await loadSeatMap(selectedShowId, false);
        return;
      }

      setConfirmDialogOpen(false);
      if (data.bulk_booking) {
        setConfirmedBulk(data.bulk_booking);
      }
      // Immediately refresh seat map to show newly booked seats as OCCUPIED
      await loadSeatMap(selectedShowId, true);
      setSingleName('');
      setSingleMobile('');
      setSingleEmail('');
      setReferenceCode('');
      setDiscountInput('0');
      setMultiCustomers([{ id: `cust_${Date.now().toString(36)}`, name: '', mobile: '', email: '', seat_ids: [] }]);
      onDataChanged();
    } catch (err) {
      setConfirmDialogOpen(false);
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingInit) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        Loading theatres, screens, movies &amp; active shows...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display font-extrabold text-xl text-slate-950 tracking-tight">
            Admin Bulk Booking &amp; Auto Seat Selection
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Corporate, group &amp; counter multi-seat allocation with atomic seat-lock protection and instant QR PDF passes
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenHistory}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800"
        >
          View Bulk Booking History →
        </button>
      </div>

      {/* Step 1: Cascading Show Selection Bar */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
            1. Select Theatre, Screen, Movie &amp; Show
          </div>
          {selectedShowId && (
            <button
              type="button"
              onClick={() => void loadSeatMap(selectedShowId, false)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh Live Seats
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Theatre</label>
            <select
              value={selectedTheatreId}
              onChange={(e) => handleTheatreChange(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-900"
            >
              {theatres.length === 0 && <option value="">No Theatres Added Yet</option>}
              {theatres.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Screen</label>
            <select
              value={selectedScreenId}
              onChange={(e) => handleScreenChange(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-900"
            >
              {filteredScreens.length === 0 && <option value="">No Screens Added Yet</option>}
              {filteredScreens.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.name} ({sc.capacity} seats)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Movie</label>
            <select
              value={selectedMovieId}
              onChange={(e) => handleMovieChange(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-900"
            >
              {filteredMovies.length === 0 && <option value="">No active shows on this screen</option>}
              {filteredMovies.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title} ({m.language})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Show Date</label>
            <select
              value={selectedDate}
              onChange={(e) => handleDateChange(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-900"
            >
              {availableDates.length === 0 && <option value="">No dates</option>}
              {availableDates.map((d) => {
                const chip = formatDateChip(d);
                return (
                  <option key={d} value={d}>
                    {chip.fullLabel} ({d})
                  </option>
                );
              })}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Show Time</label>
            <select
              value={selectedShowId}
              onChange={(e) => setSelectedShowId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-900"
            >
              {filteredShows.length === 0 && <option value="">No shows</option>}
              {filteredShows.map((sh) => (
                <option key={sh.id} value={sh.id}>
                  {sh.start_time} · {sh.format} ({sh.metrics?.available_seats ?? 0} avail)
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Unavailable Seat Collision Alert */}
      {unavailableSeatsAlert.length > 0 && (
        <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 space-y-2">
          <div className="flex items-center gap-2 font-display font-bold text-sm text-rose-900">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            Atomic Protection Triggered — Partial Booking Prevented
          </div>
          <p className="text-xs text-rose-800">
            The following seat(s) became unavailable before confirmation, so zero seats were booked. Please review and adjust:
          </p>
          <div className="flex flex-wrap gap-2">
            {unavailableSeatsAlert.map((u) => (
              <span
                key={u.seat_id}
                className="px-2.5 py-1 rounded-lg bg-white border border-rose-200 text-xs font-mono font-bold text-rose-800"
              >
                {u.seat_id}: {u.reason}
              </span>
            ))}
          </div>
        </div>
      )}

      {submitError && unavailableSeatsAlert.length === 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{submitError}</span>
        </div>
      )}

      {!seatMap ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          {loadingMap
            ? 'Loading live screen layout & seat availability...'
            : 'Select a theatre, screen, movie, and active showtime above to begin bulk booking.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_370px] gap-5 items-start">
          {/* LEFT WORKSPACE: Auto Seat Selector + Interactive Coordinate Seat Map + Customer Details */}
          <div className="space-y-5 min-w-0">
            {/* Step 2: Quantity-Based Automatic Seat Selection */}
            <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="font-display font-bold text-sm sm:text-base text-slate-950">
                      2. Quantity-Based Automatic Seat Selection
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Auto-picks exact consecutive seats respecting aisles, rows &amp; preferences
                    </p>
                  </div>
                </div>

                {/* Live Availability Counter */}
                <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold">
                    Available Seats: {availableSeats.length}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-purple-50 border border-purple-200 text-purple-800 font-bold">
                    Selected: {selectedSeatObjects.length}
                  </span>
                </div>
              </div>

              {/* Mode A (Category-wise) vs Mode B (Mixed Categories) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAutoMode('MIXED');
                    setAutoError(null);
                  }}
                  className={`p-3 rounded-xl border text-left transition-colors ${
                    autoMode === 'MIXED'
                      ? 'border-slate-950 bg-slate-950 text-white'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-800'
                  }`}
                >
                  <div className="text-xs font-display font-bold">Mode B — Mixed Category Selection</div>
                  <div className={`text-[11px] mt-0.5 ${autoMode === 'MIXED' ? 'text-slate-300' : 'text-slate-500'}`}>
                    Enter total quantity (e.g. 50) across categories automatically
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAutoMode('CATEGORY');
                    setAutoError(null);
                  }}
                  className={`p-3 rounded-xl border text-left transition-colors ${
                    autoMode === 'CATEGORY'
                      ? 'border-slate-950 bg-slate-950 text-white'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-800'
                  }`}
                >
                  <div className="text-xs font-display font-bold">Mode A — Automatic Category Selection</div>
                  <div className={`text-[11px] mt-0.5 ${autoMode === 'CATEGORY' ? 'text-slate-300' : 'text-slate-500'}`}>
                    Set exact seat counts per tier (e.g. GOLD: 10, SILVER: 25)
                  </div>
                </button>
              </div>

              {/* Quantity Inputs */}
              {autoMode === 'MIXED' ? (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-40">
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Required Quantity
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={Math.max(1, availableSeats.length)}
                      value={requestedQtyInput}
                      onChange={(e) => handleMixedQtyChange(e.target.value)}
                      placeholder="e.g. 50"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-bold text-sm text-slate-950 focus:outline-none focus:border-emerald-600"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pb-0.5">
                    {[1, 5, 10, 25, 50, 100].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => handleMixedQtyChange(String(preset))}
                        className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono font-semibold transition-colors ${
                          Number(requestedQtyInput) === preset
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                            : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  {seatMap.categories.map((cat) => (
                    <div
                      key={cat.id}
                      className="rounded-xl border border-slate-200 p-3 bg-slate-50/70 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900">
                          <span
                            className="w-2.5 h-2.5 rounded-xs shrink-0"
                            style={{ backgroundColor: cat.color }}
                          />
                          {cat.name}
                        </span>
                        <span className="font-mono text-[11px] font-semibold text-slate-600">
                          {formatINR(cat.resolved_price)}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {cat.available_count} available
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={cat.available_count}
                        value={categoryQuantities[cat.id] ?? '0'}
                        onChange={(e) => handleCategoryQtyChange(cat.id, e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-mono font-bold text-sm text-slate-950 focus:outline-none focus:border-emerald-600"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Advanced Options Accordion */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-700 hover:bg-slate-100/80"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
                    Advanced Selection Preferences (Row Zone, Centre, Adjacent &amp; Category Priority)
                  </span>
                  {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                {showAdvanced && (
                  <div className="px-3.5 pb-3.5 pt-2 border-t border-slate-200 space-y-3 text-xs">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={sameRowPriority}
                          onChange={(e) => setSameRowPriority(e.target.checked)}
                          className="rounded border-slate-300 accent-emerald-600"
                        />
                        <span className="font-medium text-slate-800">Same Row Priority</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={adjacentSeatsPriority}
                          onChange={(e) => setAdjacentSeatsPriority(e.target.checked)}
                          className="rounded border-slate-300 accent-emerald-600"
                        />
                        <span className="font-medium text-slate-800">Adjacent Seats Priority</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={centreSeatsPriority}
                          onChange={(e) => setCentreSeatsPriority(e.target.checked)}
                          className="rounded border-slate-300 accent-emerald-600"
                        />
                        <span className="font-medium text-slate-800">Centre Seats Priority</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={allowMultipleRows}
                          onChange={(e) => setAllowMultipleRows(e.target.checked)}
                          className="rounded border-slate-300 accent-emerald-600"
                        />
                        <span className="font-medium text-slate-800">Allow Multiple Rows</span>
                      </label>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">Row Position</label>
                        <div className="grid grid-cols-4 gap-1">
                          {(
                            [
                              { id: 'ANY', label: 'Any' },
                              { id: 'FRONT', label: 'Front Rows' },
                              { id: 'MIDDLE', label: 'Middle Rows' },
                              { id: 'BACK', label: 'Back Rows' },
                            ] as Array<{ id: RowZonePreference; label: string }>
                          ).map((z) => (
                            <button
                              key={z.id}
                              type="button"
                              onClick={() => setRowZone(z.id)}
                              className={`py-1.5 px-2 rounded-lg border text-[11px] font-semibold transition-colors ${
                                rowZone === z.id
                                  ? 'border-slate-950 bg-slate-950 text-white'
                                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              {z.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          Specific Category Filter
                        </label>
                        <select
                          value={specificCategoryId}
                          onChange={(e) => setSpecificCategoryId(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-900"
                        >
                          <option value="ALL">All Categories ({availableSeats.length} avail)</option>
                          {seatMap.categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} — {formatINR(c.resolved_price)} ({c.available_count} avail)
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Primary Auto-Selection Controls */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => triggerAutoSelect(0)}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  Auto Select Seats
                </button>
                <button
                  type="button"
                  disabled={requestedTotalQuantity <= 0}
                  onClick={() => triggerAutoSelect(candidateOffset + 1)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-900 text-xs font-semibold disabled:opacity-40"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Select Next Available Seats
                  {candidateCount > 1 && selectionSource === 'AUTO' && (
                    <span className="font-mono text-[10px] text-slate-500">
                      ({(candidateOffset % candidateCount) + 1}/{candidateCount})
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => seatCanvasSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold"
                >
                  <MousePointerClick className="w-3.5 h-3.5" />
                  Change Selection
                </button>
                <button
                  type="button"
                  disabled={selectedSeatIds.length === 0}
                  onClick={handleClearSelection}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear All Selected Seats
                </button>
              </div>

              {/* Overflow / Error Feedback */}
              {autoError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-800 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{autoError}</span>
                </div>
              )}

              {autoInfo && !autoError && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-900 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{autoInfo}</span>
                </div>
              )}

              {/* Live Selection Summary */}
              {selectedSeatObjects.length > 0 && (
                <div className="rounded-xl border border-purple-200 bg-purple-50/40 p-3.5 space-y-2.5 text-xs">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div>
                      <div className="text-[11px] text-slate-500">Requested Quantity</div>
                      <div className="font-mono font-bold text-slate-950 tabular-nums">
                        {liveSummary.requestedQuantity || selectedSeatObjects.length}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Successfully Selected</div>
                      <div className="font-mono font-bold text-purple-700 tabular-nums">
                        {selectedSeatObjects.length}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Remaining Available</div>
                      <div className="font-mono font-bold text-emerald-700 tabular-nums">
                        {liveSummary.remainingAvailable}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Total Ticket Price</div>
                      <div className="font-mono font-bold text-slate-950 tabular-nums">
                        {formatINR(liveSummary.totalPrice)}
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-purple-200/70 space-y-1.5">
                    <div className="text-[11px] text-slate-700">
                      <strong>Selected Rows:</strong>{' '}
                      <span className="font-mono font-semibold">{liveSummary.selectedRows.join(', ')}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {liveSummary.categorySummary.map((cat) => (
                        <span
                          key={cat.category_id}
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[11px] font-semibold text-slate-800"
                        >
                          <span className="w-2 h-2 rounded-xs" style={{ backgroundColor: cat.category_color }} />
                          {cat.category_name}: {cat.count} × {formatINR(cat.unit_price)} = {formatINR(cat.subtotal)}
                        </span>
                      ))}
                    </div>
                    <div className="text-[11px] text-slate-600 max-h-20 overflow-y-auto leading-relaxed">
                      <strong>Selected Seats ({selectedSeatObjects.length}):</strong>{' '}
                      <span className="font-mono">
                        {selectedSeatObjects
                          .map((s) => `${s.id} (${s.category_name} ₹${s.resolved_price})`)
                          .join(', ')}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* Step 3: Interactive Coordinate-Exact Bulk Seat Map */}
            <section
              ref={seatCanvasSectionRef}
              className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-display font-bold text-sm sm:text-base text-slate-950">
                    3. Interactive Screen Layout ({seatMap.screen.name})
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Click individual seats, click Row labels to toggle entire rows, click Category chips, or click &amp; drag a selection box
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleSelectAllAvailable}
                    className="px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold"
                  >
                    Select All Available ({availableSeats.length})
                  </button>
                  <button
                    type="button"
                    onClick={handleClearSelection}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700"
                  >
                    Clear Selection
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 100) / 100))}
                    className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"
                    aria-label="Zoom out"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="font-mono text-xs w-9 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.min(1.25, Math.round((z + 0.1) * 100) / 100))}
                    className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"
                    aria-label="Zoom in"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Category Quick-Select Strip */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold text-slate-500">Select Category:</span>
                {seatMap.categories.map((cat) => {
                  const catAvail = seatMap.seats.filter(
                    (s) => s.category_id === cat.id && s.status === 'AVAILABLE'
                  );
                  const allChosen = catAvail.length > 0 && catAvail.every((s) => selectedSet.has(s.id));
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      disabled={catAvail.length === 0}
                      onClick={() => toggleCategorySeats(cat.id)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-40 ${
                        allChosen
                          ? 'border-purple-600 bg-purple-600 text-white'
                          : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-800'
                      }`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-xs shrink-0"
                        style={{ backgroundColor: allChosen ? '#FFFFFF' : cat.color }}
                      />
                      {cat.name} ({formatINR(cat.resolved_price)} · {catAvail.length})
                    </button>
                  );
                })}
              </div>

              {/* Row Quick-Select Strip (works great on Android mobile & touchscreens!) */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold text-slate-500 mr-1">Rows:</span>
                {seatMap.layout.rows.map((r) => {
                  const rowAvail = seatMap.seats.filter((s) => s.row === r.label && s.status === 'AVAILABLE');
                  const allRowSel = rowAvail.length > 0 && rowAvail.every((s) => selectedSet.has(s.id));
                  const someRowSel = rowAvail.some((s) => selectedSet.has(s.id));
                  return (
                    <button
                      key={r.label}
                      type="button"
                      disabled={rowAvail.length === 0}
                      onClick={() => toggleRowSeats(r.label)}
                      className={`px-2 py-1 rounded-md border font-mono text-[11px] font-bold transition-colors disabled:opacity-35 ${
                        allRowSel
                          ? 'border-purple-600 bg-purple-600 text-white'
                          : someRowSel
                          ? 'border-purple-300 bg-purple-50 text-purple-800'
                          : 'border-slate-200 bg-white hover:bg-slate-100 text-slate-700'
                      }`}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>

              {/* Coordinate-Exact Canvas with Drag Marquee */}
              <div className="rounded-xl border border-slate-200 bg-slate-100 p-3 sm:p-4 overflow-auto">
                {seatMap.layout.screen_direction === 'TOP' && (
                  <div className="text-center mb-3 text-[11px] font-display font-bold tracking-[0.2em] text-purple-700">
                    SCREEN THIS WAY
                  </div>
                )}

                <div
                  className="relative bg-white rounded-xl border border-slate-300 mx-auto overflow-hidden select-none"
                  style={{
                    width: Math.round(seatMap.layout.screen_width * zoom),
                    height: Math.round(seatMap.layout.screen_height * zoom),
                  }}
                  onMouseDown={handleCanvasMouseDown}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={finishDragSelection}
                  onMouseLeave={finishDragSelection}
                >
                  <div
                    ref={canvasInnerRef}
                    className="relative origin-top-left"
                    style={{
                      width: seatMap.layout.screen_width,
                      height: seatMap.layout.screen_height,
                      transform: `scale(${zoom})`,
                    }}
                  >
                    {/* Aisles */}
                    {seatMap.layout.aisles.map((a) => (
                      <div
                        key={a.id}
                        style={{ left: a.x, top: a.y, width: a.width, height: a.height }}
                        className="absolute border border-dashed border-slate-200 bg-slate-50/70 flex items-center justify-center text-[10px] font-mono text-slate-400 pointer-events-none"
                      >
                        {a.orientation === 'horizontal' ? a.label || 'Walkway' : ''}
                      </div>
                    ))}

                    {/* Interactive Row Labels */}
                    {seatMap.layout.rows.map((r) => (
                      <button
                        key={r.label}
                        type="button"
                        data-row-btn="true"
                        onClick={() => toggleRowSeats(r.label)}
                        title={`Toggle entire Row ${r.label}`}
                        style={{ top: r.y + 2, left: 10 }}
                        className="absolute w-7 h-6 rounded bg-slate-100 hover:bg-purple-100 hover:text-purple-800 font-mono font-bold text-xs text-slate-600 flex items-center justify-center transition-colors"
                      >
                        {r.label}
                      </button>
                    ))}

                    {/* Exact-Coordinate Seats */}
                    {seatMap.seats.map((seat) => {
                      const isSelected = selectedSet.has(seat.id);
                      const disabled = seat.status !== 'AVAILABLE';
                      let bg = '#FFFFFF';
                      let border = seat.category_color || '#334155';
                      let text = '#0F172A';

                      if (isSelected) {
                        bg = '#7C3AED';
                        border = '#6D28D9';
                        text = '#FFFFFF';
                      } else if (seat.status === 'OCCUPIED') {
                        bg = '#E2E8F0';
                        border = '#CBD5E1';
                        text = '#94A3B8';
                      } else if (seat.status === 'BLOCKED') {
                        bg = '#475569';
                        border = '#334155';
                        text = '#FFFFFF';
                      } else if (seat.status === 'LOCKED') {
                        bg = '#FEF3C7';
                        border = '#D97706';
                        text = '#92400E';
                      }

                      return (
                        <button
                          key={seat.id}
                          type="button"
                          data-seat-btn="true"
                          disabled={disabled}
                          onClick={() => toggleSingleSeat(seat)}
                          title={`${seat.id} · ${seat.category_name} · ${formatINR(seat.resolved_price)} · ${seat.status}`}
                          style={{
                            left: seat.x,
                            top: seat.y,
                            width: seat.width,
                            height: seat.height,
                            backgroundColor: bg,
                            borderColor: border,
                            color: text,
                          }}
                          className={`absolute rounded-md border-2 flex items-center justify-center font-mono text-[10px] font-bold transition-transform ${
                            disabled ? 'cursor-not-allowed opacity-85' : 'cursor-pointer hover:scale-105'
                          }`}
                        >
                          {seat.status === 'OCCUPIED' ? '×' : seat.id}
                        </button>
                      );
                    })}

                    {/* Drag Selection Marquee Overlay */}
                    {dragRect && (
                      <div
                        style={{
                          left: Math.min(dragRect.startX, dragRect.currentX),
                          top: Math.min(dragRect.startY, dragRect.currentY),
                          width: Math.abs(dragRect.currentX - dragRect.startX),
                          height: Math.abs(dragRect.currentY - dragRect.startY),
                        }}
                        className="absolute border-2 border-purple-600 bg-purple-500/15 pointer-events-none rounded-sm"
                      />
                    )}
                  </div>
                </div>

                {seatMap.layout.screen_direction === 'BOTTOM' && (
                  <div className="text-center mt-3 text-[11px] font-display font-bold tracking-[0.2em] text-purple-700">
                    SCREEN THIS WAY
                  </div>
                )}
              </div>

              {/* Seat Status Legend */}
              <div className="flex flex-wrap items-center justify-center gap-4 text-[11px] text-slate-600 pt-1">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded-xs border-2 border-slate-700 bg-white" /> Available
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded-xs bg-purple-600" /> Selected
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded-xs bg-slate-200 border border-slate-300" /> Occupied
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded-xs bg-slate-600" /> Blocked
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded-xs bg-amber-100 border border-amber-500" /> Locked
                </span>
              </div>
            </section>

            {/* Step 4: Customer Details (Mode A Single / Mode B Multiple + CSV Import) */}
            <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display font-bold text-sm sm:text-base text-slate-950">
                    4. Customer Details &amp; Seat Assignment
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Issue all selected seats under one customer or assign individual seats to multiple customers
                  </p>
                </div>

                <div className="inline-flex rounded-xl bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => setCustomerMode('SINGLE_CUSTOMER')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      customerMode === 'SINGLE_CUSTOMER'
                        ? 'bg-white text-slate-950 shadow-2xs'
                        : 'text-slate-600'
                    }`}
                  >
                    Mode A: Single Customer
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomerMode('MULTIPLE_CUSTOMERS')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      customerMode === 'MULTIPLE_CUSTOMERS'
                        ? 'bg-white text-slate-950 shadow-2xs'
                        : 'text-slate-600'
                    }`}
                  >
                    Mode B: Multiple Customers
                  </button>
                </div>
              </div>

              {customerMode === 'SINGLE_CUSTOMER' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Customer Name <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="text"
                      value={singleName}
                      onChange={(e) => setSingleName(e.target.value)}
                      placeholder="e.g. Tenkasi Lions Club / Ravi Kumar"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-emerald-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Mobile Number <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="tel"
                      value={singleMobile}
                      onChange={(e) => setSingleMobile(e.target.value)}
                      placeholder="+91 98421 00000"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-emerald-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Email (Optional)</label>
                    <input
                      type="email"
                      value={singleEmail}
                      onChange={(e) => setSingleEmail(e.target.value)}
                      placeholder="contact@organization.in"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-emerald-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Booking Reference</label>
                    <input
                      type="text"
                      value={referenceCode}
                      onChange={(e) => setReferenceCode(e.target.value)}
                      placeholder="e.g. CORP-2026-042 / PO #889"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-mono focus:outline-none focus:border-emerald-600"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Multi-customer Toolbar: CSV/Excel Import + Sample + Add Customer + Auto-Distribute */}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        ref={customerFileRef}
                        type="file"
                        accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        onChange={handleCustomerCsvUpload}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => customerFileRef.current?.click()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-white text-xs font-semibold"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                        Import CSV / Excel
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadSampleCustomerCsv(selectedSeatIds)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Sample CSV
                      </button>
                      <button
                        type="button"
                        onClick={handleAddCustomerRow}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        Add Customer
                      </button>
                      <button
                        type="button"
                        disabled={selectedSeatIds.length === 0}
                        onClick={handleAutoDistributeSeats}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-800 text-xs font-semibold disabled:opacity-40"
                      >
                        <Users className="w-3.5 h-3.5" />
                        Auto-Distribute Seats
                      </button>
                    </div>

                    <div className="text-xs font-mono">
                      Unassigned:{' '}
                      <strong className={unassignedSeatIds.length > 0 ? 'text-amber-700' : 'text-emerald-700'}>
                        {unassignedSeatIds.length}
                      </strong>
                      /{selectedSeatIds.length}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Group / Batch Reference (Optional)
                    </label>
                    <input
                      type="text"
                      value={referenceCode}
                      onChange={(e) => setReferenceCode(e.target.value)}
                      placeholder="e.g. TEAM-OUTING-NOV26"
                      className="w-full sm:w-72 px-3 py-2 rounded-xl border border-slate-200 text-xs font-mono"
                    />
                  </div>

                  {csvImportMsg && (
                    <div
                      className={`rounded-xl border px-3.5 py-2 text-xs font-medium ${
                        csvImportMsg.type === 'ok'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                          : 'border-rose-200 bg-rose-50 text-rose-800'
                      }`}
                    >
                      {csvImportMsg.text}
                    </div>
                  )}

                  {/* Customer Assignment Cards */}
                  <div className="space-y-3">
                    {multiCustomers.map((cust, idx) => (
                      <div key={cust.id} className="rounded-xl border border-slate-200 p-3.5 space-y-3 bg-white">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-display font-bold text-slate-900">
                            Customer #{idx + 1}{' '}
                            <span className="font-mono font-semibold text-purple-700">
                              ({cust.seat_ids.length} seat{cust.seat_ids.length !== 1 ? 's' : ''})
                            </span>
                          </span>
                          {multiCustomers.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveCustomerRow(cust.id)}
                              className="text-xs text-rose-600 hover:text-rose-700 font-semibold"
                            >
                              Remove
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          <input
                            type="text"
                            placeholder="Customer Name *"
                            value={cust.name}
                            onChange={(e) =>
                              setMultiCustomers((prev) =>
                                prev.map((c) => (c.id === cust.id ? { ...c, name: e.target.value } : c))
                              )
                            }
                            className="px-3 py-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-emerald-600"
                          />
                          <input
                            type="tel"
                            placeholder="Mobile Number *"
                            value={cust.mobile}
                            onChange={(e) =>
                              setMultiCustomers((prev) =>
                                prev.map((c) => (c.id === cust.id ? { ...c, mobile: e.target.value } : c))
                              )
                            }
                            className="px-3 py-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-emerald-600"
                          />
                          <input
                            type="email"
                            placeholder="Email (optional)"
                            value={cust.email}
                            onChange={(e) =>
                              setMultiCustomers((prev) =>
                                prev.map((c) => (c.id === cust.id ? { ...c, email: e.target.value } : c))
                              )
                            }
                            className="px-3 py-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-emerald-600"
                          />
                        </div>

                        {/* Seat chips assigner for this customer */}
                        {selectedSeatIds.length > 0 ? (
                          <div className="space-y-1.5">
                            <div className="text-[11px] font-semibold text-slate-500">
                              Assign seats from selection (click to assign/unassign):
                            </div>
                            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                              {selectedSeatIds.map((sid) => {
                                const mine = cust.seat_ids.includes(sid);
                                const owner = assignedSeatOwnerMap.get(sid);
                                const takenByOther = owner && owner !== cust.id;
                                return (
                                  <button
                                    key={sid}
                                    type="button"
                                    onClick={() => handleToggleSeatForCustomer(cust.id, sid)}
                                    className={`px-2 py-1 rounded-md border font-mono text-[11px] font-bold transition-colors ${
                                      mine
                                        ? 'border-purple-600 bg-purple-600 text-white'
                                        : takenByOther
                                        ? 'border-slate-200 bg-slate-100 text-slate-400 hover:border-purple-300'
                                        : 'border-slate-300 bg-white text-slate-800 hover:border-emerald-500'
                                    }`}
                                  >
                                    {sid}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-400">
                            Select seats above to assign them to this customer.
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* RIGHT STICKY COLUMN: Bulk Booking Summary & Confirm */}
          <aside className="xl:sticky xl:top-20 rounded-2xl border border-slate-200 bg-white p-5 space-y-4 shadow-xs">
            <div className="border-b border-slate-100 pb-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                Bulk Booking Summary
              </div>
              <h3 className="font-display font-bold text-base text-slate-950 mt-0.5 truncate">
                {seatMap.movie.title}
              </h3>
              <div className="text-xs text-slate-500 mt-0.5">
                {seatMap.theatre.name} · {seatMap.screen.name}
              </div>
              <div className="text-xs font-medium text-slate-700 mt-0.5">
                {formatDateChip(seatMap.show.show_date).fullLabel} · <strong>{seatMap.show.start_time}</strong>
              </div>
            </div>

            {/* Seat & Category Breakdown */}
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between font-semibold text-slate-800">
                <span>Total Selected Seats</span>
                <span className="font-mono text-purple-700 text-sm">{selectedSeatObjects.length}</span>
              </div>

              {liveSummary.categorySummary.length === 0 ? (
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center text-slate-400">
                  No seats selected yet. Use Auto Select or pick seats on the map.
                </div>
              ) : (
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2">
                  {liveSummary.categorySummary.map((c) => (
                    <div key={c.category_id} className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-slate-700 font-medium">
                        <span className="w-2.5 h-2.5 rounded-xs" style={{ backgroundColor: c.category_color }} />
                        {c.category_name} ({c.count} × {formatINR(c.unit_price)})
                      </span>
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">
                        {formatINR(c.subtotal)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Fee, Discount & Payment Adjustments */}
            <div className="space-y-3 pt-2 border-t border-slate-100 text-xs">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Conv. Fee / Seat (₹)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={convenienceFeePerSeat}
                    onChange={(e) => setConvenienceFeePerSeat(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Discount ({discountType === 'FLAT' ? '₹' : '%'})
                  </label>
                  <div className="flex gap-1">
                    <input
                      type="number"
                      min={0}
                      value={discountInput}
                      onChange={(e) => setDiscountInput(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setDiscountType((t) => (t === 'FLAT' ? 'PERCENT' : 'FLAT'))}
                      className="px-2 rounded-lg border border-slate-200 bg-slate-50 font-mono font-bold text-slate-700"
                      title="Toggle Flat ₹ / Percent %"
                    >
                      {discountType === 'FLAT' ? '₹' : '%'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 items-center">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Payment Mode</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium"
                  >
                    <option value="Corporate Invoice">Corporate Invoice</option>
                    <option value="Cash Counter">Cash Counter</option>
                    <option value="UPI">UPI</option>
                    <option value="Card">Card</option>
                    <option value="NEFT / Bank Transfer">NEFT / Bank Transfer</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 pt-4 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={applyTax}
                    onChange={(e) => setApplyTax(e.target.checked)}
                    className="rounded border-slate-300 accent-emerald-600"
                  />
                  <span className="text-[11px] font-medium text-slate-700">Apply GST ({financials.taxRate}%)</span>
                </label>
              </div>
            </div>

            {/* Totals Breakdown */}
            <div className="space-y-1.5 pt-3 border-t border-slate-200 text-xs tabular-nums">
              <div className="flex justify-between text-slate-600">
                <span>Total Ticket Amount</span>
                <span className="font-mono font-semibold text-slate-900">{formatINR(financials.subtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Convenience Fee</span>
                <span className="font-mono text-slate-900">{formatINR(financials.convFee)}</span>
              </div>
              {financials.discount > 0 && (
                <div className="flex justify-between text-emerald-700 font-medium">
                  <span>Bulk Discount</span>
                  <span className="font-mono">-{formatINR(financials.discount)}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-600">
                <span>GST ({financials.taxRate}% on conv. fee)</span>
                <span className="font-mono text-slate-900">{formatINR(financials.tax)}</span>
              </div>
              <div className="flex justify-between items-baseline pt-2 border-t border-slate-200">
                <span className="font-display font-bold text-sm text-slate-950">Final Payable Amount</span>
                <span className="font-display font-extrabold text-lg text-emerald-700 font-mono">
                  {formatINR(financials.total)}
                </span>
              </div>
            </div>

            <button
              type="button"
              disabled={selectedSeatObjects.length === 0 || submitting}
              onClick={handleOpenConfirmDialog}
              className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-display font-bold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-40 transition-colors"
            >
              <ShieldCheck className="w-4 h-4" />
              Confirm Bulk Booking ({selectedSeatObjects.length})
            </button>
          </aside>
        </div>
      )}

      {/* Overwrite Manual Selection Confirmation Dialog */}
      {pendingOverwriteConfirm && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl border border-slate-200 shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display font-bold text-base text-slate-950">
                  Overwrite Manually Selected Seats?
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  You currently have <strong>{manualSeatIds.size}</strong> manually selected seat(s). How would you like Auto Select to proceed?
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingOverwriteConfirm(null)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const off = pendingOverwriteConfirm.nextOffset;
                  setPendingOverwriteConfirm(null);
                  executeAutoSelect(off, 'KEEP_MANUAL');
                }}
                className="px-3.5 py-2 rounded-xl border border-purple-300 bg-purple-50 text-purple-800 text-xs font-semibold"
              >
                Keep Manual &amp; Add Remaining
              </button>
              <button
                type="button"
                onClick={() => {
                  const off = pendingOverwriteConfirm.nextOffset;
                  setPendingOverwriteConfirm(null);
                  executeAutoSelect(off, 'REPLACE');
                }}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
              >
                Replace All Seats
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pre-Booking Confirmation Dialog */}
      {confirmDialogOpen && seatMap && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-display font-bold text-base text-slate-950">Confirm Atomic Bulk Booking</h3>
              <button
                type="button"
                onClick={() => setConfirmDialogOpen(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-1.5">
                <div className="font-display font-bold text-sm text-slate-950">{seatMap.movie.title}</div>
                <div className="text-slate-600">
                  {seatMap.theatre.name} · {seatMap.screen.name}
                </div>
                <div className="text-slate-700">
                  {formatDateChip(seatMap.show.show_date).fullLabel} at <strong>{seatMap.show.start_time}</strong>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="text-slate-500">Booking Mode</div>
                  <div className="font-semibold text-slate-900 mt-0.5">
                    {customerMode === 'SINGLE_CUSTOMER'
                      ? `Single Customer (${singleName})`
                      : `${multiCustomers.length} Customers`}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="text-slate-500">Tickets &amp; Payable</div>
                  <div className="font-mono font-bold text-emerald-700 mt-0.5">
                    {selectedSeatObjects.length} tickets · {formatINR(financials.total)}
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-slate-600 leading-relaxed">
                <strong>Seats:</strong>{' '}
                <span className="font-mono">{selectedSeatObjects.map((s) => s.id).join(', ')}</span>
              </div>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[11px] text-emerald-900">
                Protected by atomic SQLite transaction — if any seat is occupied, blocked, or locked by a customer, zero seats will be partially booked.
              </div>
            </div>
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setConfirmDialogOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleCommitBulkBooking}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50"
              >
                {submitting ? 'Confirming & Generating QR Tickets...' : 'Confirm & Issue Tickets'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation & Individual QR Tickets Modal (Print + PDF Download) */}
      <BulkTicketConfirmationModal record={confirmedBulk} onClose={() => setConfirmedBulk(null)} />
    </div>
  );
}
