import type { ResolvedSeat, ScreenLayoutV2 } from '../types';

export type AutoSelectMode = 'CATEGORY' | 'MIXED';
export type RowZonePreference = 'ANY' | 'FRONT' | 'MIDDLE' | 'BACK';

export interface AutoSeatSelectOptions {
  mode: AutoSelectMode;
  totalQuantity: number;
  categoryQuantities?: Record<string, number>;
  sameRowPriority: boolean;
  adjacentSeatsPriority: boolean;
  centreSeatsPriority: boolean;
  rowZone: RowZonePreference;
  specificCategoryId: string; // 'ALL' or category id
  allowMultipleRows: boolean;
  excludeSeatIds?: Set<string>;
  candidateOffset?: number;
}

export interface AutoSeatSelectResult {
  ok: boolean;
  error?: string;
  requestedQuantity: number;
  selectedSeats: ResolvedSeat[];
  remainingAvailable: number;
  selectedRows: string[];
  categorySummary: Array<{
    category_id: string;
    category_name: string;
    category_color: string;
    unit_price: number;
    count: number;
    subtotal: number;
  }>;
  totalPrice: number;
  candidateCount: number;
  appliedCandidateIndex: number;
}

interface RowGroup {
  rowLabel: string;
  y: number;
  seats: ResolvedSeat[];
  runs: ResolvedSeat[][];
  zoneIndex: number; // 0 = front, 1 = middle, 2 = back (relative to screen_direction)
  zoneScore: number;
}

/**
 * Splits a row's available seats (sorted left-to-right by x) into contiguous physical runs
 * respecting vertical aisles, block changes, and physical coordinate gaps.
 */
function splitRowIntoContiguousRuns(
  rowSeatsSorted: ResolvedSeat[],
  layout: ScreenLayoutV2
): ResolvedSeat[][] {
  if (rowSeatsSorted.length === 0) return [];
  const verticalAisles = (layout.aisles || []).filter((a) => a.orientation === 'vertical');

  const runs: ResolvedSeat[][] = [];
  let currentRun: ResolvedSeat[] = [rowSeatsSorted[0]];

  for (let i = 1; i < rowSeatsSorted.length; i++) {
    const prev = rowSeatsSorted[i - 1];
    const curr = rowSeatsSorted[i];

    const prevRight = prev.x + prev.width;
    const gap = curr.x - prevRight;

    const aisleBetween = verticalAisles.some((aisle) => {
      const aisleCenterX = aisle.x + aisle.width / 2;
      const verticalOverlap = curr.y + curr.height > aisle.y && curr.y < aisle.y + aisle.height;
      return verticalOverlap && aisleCenterX >= prevRight - 4 && aisleCenterX <= curr.x + 4;
    });

    // Also break if there's an unavailable seat / large gap between them or block boundary
    const numberGap = curr.number - prev.number > 1;
    const spatialGap = gap > Math.max(prev.width * 0.75, 22);
    const blockBreak = prev.block !== curr.block;

    if (aisleBetween || spatialGap || blockBreak || numberGap) {
      runs.push(currentRun);
      currentRun = [curr];
    } else {
      currentRun.push(curr);
    }
  }
  runs.push(currentRun);
  return runs;
}

function buildRowGroups(
  eligibleSeats: ResolvedSeat[],
  layout: ScreenLayoutV2,
  rowZone: RowZonePreference
): RowGroup[] {
  const byRow = new Map<string, ResolvedSeat[]>();
  for (const seat of eligibleSeats) {
    const list = byRow.get(seat.row) ?? [];
    list.push(seat);
    byRow.set(seat.row, list);
  }

  // Sort rows by Y coordinate relative to screen direction
  // BOTTOM screen => larger y is FRONT (closest to screen), smaller y is BACK
  // TOP screen => smaller y is FRONT (closest to screen), larger y is BACK
  const allRowsSortedFrontToBack = Array.from(byRow.entries())
    .map(([rowLabel, rowSeats]) => {
      const sortedSeats = [...rowSeats].sort((a, b) => a.x - b.x || a.number - b.number);
      const avgY = sortedSeats.reduce((acc, s) => acc + s.y, 0) / sortedSeats.length;
      return { rowLabel, y: avgY, seats: sortedSeats };
    })
    .sort((a, b) => (layout.screen_direction === 'BOTTOM' ? b.y - a.y : a.y - b.y));

  const n = allRowsSortedFrontToBack.length;
  const midIdx = (n - 1) / 2;

  return allRowsSortedFrontToBack.map((entry, idx) => {
    const ratio = n <= 1 ? 0.5 : idx / (n - 1);
    const zoneIndex = ratio < 0.34 ? 0 : ratio <= 0.67 ? 1 : 2;
    let zoneScore = 0;
    if (rowZone === 'FRONT') {
      zoneScore = idx;
    } else if (rowZone === 'BACK') {
      zoneScore = n - 1 - idx;
    } else if (rowZone === 'MIDDLE') {
      zoneScore = Math.abs(idx - midIdx);
    } else {
      // ANY: slightly prefer middle-to-back theatre sweet spot (idx near 55%)
      zoneScore = Math.abs(idx - (n - 1) * 0.55);
    }

    return {
      rowLabel: entry.rowLabel,
      y: entry.y,
      seats: entry.seats,
      runs: splitRowIntoContiguousRuns(entry.seats, layout),
      zoneIndex,
      zoneScore,
    };
  });
}

function scoreSeatClusterCentre(seats: ResolvedSeat[], centerX: number): number {
  if (seats.length === 0) return Number.MAX_SAFE_INTEGER;
  const avgX = seats.reduce((sum, s) => sum + (s.x + s.width / 2), 0) / seats.length;
  return Math.abs(avgX - centerX);
}

function pickFromRuns(
  runs: ResolvedSeat[][],
  needed: number,
  centerX: number,
  adjacentPriority: boolean,
  centrePriority: boolean
): ResolvedSeat[] {
  if (needed <= 0) return [];

  // 1. If a single unbroken run has >= needed seats, pick best contiguous slice inside it
  const fittingRuns = runs.filter((r) => r.length >= needed);
  if (fittingRuns.length > 0 && adjacentPriority) {
    let bestSlice: ResolvedSeat[] = fittingRuns[0].slice(0, needed);
    let bestScore = Number.MAX_SAFE_INTEGER;
    for (const run of fittingRuns) {
      for (let start = 0; start <= run.length - needed; start++) {
        const slice = run.slice(start, start + needed);
        const score = centrePriority ? scoreSeatClusterCentre(slice, centerX) : start;
        if (score < bestScore) {
          bestScore = score;
          bestSlice = slice;
        }
      }
    }
    return bestSlice;
  }

  // 2. Otherwise combine runs in priority order (respecting contiguous runs)
  const orderedRuns = [...runs].sort((a, b) => {
    if (adjacentPriority && b.length !== a.length) return b.length - a.length;
    if (centrePriority) {
      return scoreSeatClusterCentre(a, centerX) - scoreSeatClusterCentre(b, centerX);
    }
    return a[0].x - b[0].x;
  });

  const picked: ResolvedSeat[] = [];
  for (const run of orderedRuns) {
    if (picked.length >= needed) break;
    const rem = needed - picked.length;
    if (run.length <= rem) {
      picked.push(...run);
    } else if (centrePriority) {
      // Pick contiguous sub-slice of length `rem` closest to centerX
      let bestSlice = run.slice(0, rem);
      let bestScore = Number.MAX_SAFE_INTEGER;
      for (let start = 0; start <= run.length - rem; start++) {
        const slice = run.slice(start, start + rem);
        const sc = scoreSeatClusterCentre(slice, centerX);
        if (sc < bestScore) {
          bestScore = sc;
          bestSlice = slice;
        }
      }
      picked.push(...bestSlice);
    } else {
      picked.push(...run.slice(0, rem));
    }
  }
  return picked;
}

function selectExactFromPool(
  eligibleSeats: ResolvedSeat[],
  quantity: number,
  layout: ScreenLayoutV2,
  opts: {
    sameRowPriority: boolean;
    adjacentSeatsPriority: boolean;
    centreSeatsPriority: boolean;
    rowZone: RowZonePreference;
    allowMultipleRows: boolean;
    candidateOffset: number;
  }
): { ok: true; seats: ResolvedSeat[]; candidateCount: number; appliedIndex: number } | { ok: false; error: string } {
  if (quantity <= 0) {
    return { ok: false, error: 'Please enter a quantity of at least 1.' };
  }
  if (quantity > eligibleSeats.length) {
    return {
      ok: false,
      error: `Only ${eligibleSeats.length} seats are currently available. Please enter a quantity of ${eligibleSeats.length} or less.`,
    };
  }

  const centerX = layout.screen_width / 2;
  const rowGroups = buildRowGroups(eligibleSeats, layout, opts.rowZone);

  // Build ranked candidate solutions (each exact length `quantity`) so "Select Next Available Seats" cycles cleanly
  const candidates: Array<{ seats: ResolvedSeat[]; rank: number; key: string }> = [];
  const seenKeys = new Set<string>();

  const addCandidate = (candidateSeats: ResolvedSeat[], rank: number) => {
    if (candidateSeats.length !== quantity) return;
    const ids = candidateSeats.map((s) => s.id);
    if (new Set(ids).size !== quantity) return;
    const key = [...ids].sort().join(',');
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    candidates.push({ seats: candidateSeats, rank, key });
  };

  // Phase 1: Single-row solutions (unbroken contiguous runs first, then same-row across aisles)
  if (opts.sameRowPriority || !opts.allowMultipleRows) {
    const sortedRows = [...rowGroups].sort((a, b) => a.zoneScore - b.zoneScore);
    for (const rg of sortedRows) {
      if (rg.seats.length < quantity) continue;

      // Every unbroken run fitting quantity
      for (const run of rg.runs) {
        if (run.length < quantity) continue;
        // Pick best window in this run
        let bestSlice = run.slice(0, quantity);
        let bestCentre = Number.MAX_SAFE_INTEGER;
        for (let start = 0; start <= run.length - quantity; start++) {
          const slice = run.slice(start, start + quantity);
          const cScore = opts.centreSeatsPriority ? scoreSeatClusterCentre(slice, centerX) : start * 10;
          if (cScore < bestCentre) {
            bestCentre = cScore;
            bestSlice = slice;
          }
        }
        addCandidate(bestSlice, rg.zoneScore * 1000 + bestCentre);
      }

      // Same-row across aisles if unbroken run didn't exist or as secondary candidate
      const crossAisle = pickFromRuns(
        rg.runs,
        quantity,
        centerX,
        opts.adjacentSeatsPriority,
        opts.centreSeatsPriority
      );
      if (crossAisle.length === quantity) {
        const cScore = opts.centreSeatsPriority ? scoreSeatClusterCentre(crossAisle, centerX) : 0;
        addCandidate(crossAisle, 50_000 + rg.zoneScore * 1000 + cScore);
      }
    }

    if (!opts.allowMultipleRows) {
      if (candidates.length === 0) {
        const maxSingleRow = rowGroups.reduce((m, r) => Math.max(m, r.seats.length), 0);
        return {
          ok: false,
          error: `No single row has ${quantity} available seats (largest single row has ${maxSingleRow}). Enable "Allow Multiple Rows" or enter ${maxSingleRow} or less.`,
        };
      }
      candidates.sort((a, b) => a.rank - b.rank);
      const idx = ((opts.candidateOffset % candidates.length) + candidates.length) % candidates.length;
      return { ok: true, seats: candidates[idx].seats, candidateCount: candidates.length, appliedIndex: idx };
    }
  }

  // Phase 2: Multi-row contiguous/adjacent row combinations
  // rowGroups is already sorted front -> back. Try starting at each row and sweeping adjacent rows outward!
  const rowCount = rowGroups.length;
  const startRowOrder = Array.from({ length: rowCount }, (_, i) => i).sort(
    (a, b) => rowGroups[a].zoneScore - rowGroups[b].zoneScore
  );

  for (const startIdx of startRowOrder) {
    // Expand to adjacent rows from startIdx in the preferred direction
    const rowVisitOrder: number[] = [startIdx];
    for (let dist = 1; dist < rowCount; dist++) {
      if (opts.rowZone === 'FRONT') {
        if (startIdx + dist < rowCount) rowVisitOrder.push(startIdx + dist);
        if (startIdx - dist >= 0) rowVisitOrder.push(startIdx - dist);
      } else if (opts.rowZone === 'BACK') {
        if (startIdx - dist >= 0) rowVisitOrder.push(startIdx - dist);
        if (startIdx + dist < rowCount) rowVisitOrder.push(startIdx + dist);
      } else {
        // Middle / Any: alternate adjacent rows outward keeping block compact
        if (startIdx + dist < rowCount) rowVisitOrder.push(startIdx + dist);
        if (startIdx - dist >= 0) rowVisitOrder.push(startIdx - dist);
      }
    }

    const picked: ResolvedSeat[] = [];
    for (const rIdx of rowVisitOrder) {
      if (picked.length >= quantity) break;
      const rg = rowGroups[rIdx];
      const rem = quantity - picked.length;
      if (rg.seats.length <= rem) {
        picked.push(...rg.seats);
      } else {
        const partial = pickFromRuns(
          rg.runs,
          rem,
          centerX,
          opts.adjacentSeatsPriority,
          opts.centreSeatsPriority
        );
        picked.push(...partial);
      }
    }

    if (picked.length === quantity) {
      const avgZone =
        picked.reduce((sum, s) => {
          const rg = rowGroups.find((g) => g.rowLabel === s.row);
          return sum + (rg ? rg.zoneScore : 0);
        }, 0) / picked.length;
      const avgCentre = opts.centreSeatsPriority ? scoreSeatClusterCentre(picked, centerX) : 0;
      const uniqueRowSpan = new Set(picked.map((s) => s.row)).size;
      const basePenalty = uniqueRowSpan === 1 ? 0 : 100_000;
      addCandidate(picked, basePenalty + uniqueRowSpan * 2000 + avgZone * 500 + avgCentre);
    }
  }

  candidates.sort((a, b) => a.rank - b.rank);
  if (candidates.length === 0) {
    return {
      ok: false,
      error: `Only ${eligibleSeats.length} seats are currently available. Please enter a quantity of ${eligibleSeats.length} or less.`,
    };
  }

  const idx = ((opts.candidateOffset % candidates.length) + candidates.length) % candidates.length;
  return {
    ok: true,
    seats: candidates[idx].seats,
    candidateCount: candidates.length,
    appliedIndex: idx,
  };
}

export function summarizeSeatSelection(
  selectedSeats: ResolvedSeat[],
  totalAvailableCount: number,
  requestedQuantity: number
): Omit<AutoSeatSelectResult, 'ok' | 'error' | 'candidateCount' | 'appliedCandidateIndex'> {
  const rowSet = new Set<string>();
  const catMap = new Map<
    string,
    {
      category_id: string;
      category_name: string;
      category_color: string;
      unit_price: number;
      count: number;
      subtotal: number;
    }
  >();

  let totalPrice = 0;
  for (const s of selectedSeats) {
    rowSet.add(s.row);
    totalPrice += s.resolved_price;
    const existing = catMap.get(s.category_id);
    if (existing) {
      existing.count += 1;
      existing.subtotal = Math.round((existing.subtotal + s.resolved_price) * 100) / 100;
    } else {
      catMap.set(s.category_id, {
        category_id: s.category_id,
        category_name: s.category_name,
        category_color: s.category_color,
        unit_price: s.resolved_price,
        count: 1,
        subtotal: Math.round(s.resolved_price * 100) / 100,
      });
    }
  }

  return {
    requestedQuantity,
    selectedSeats,
    remainingAvailable: Math.max(0, totalAvailableCount - selectedSeats.length),
    selectedRows: Array.from(rowSet),
    categorySummary: Array.from(catMap.values()),
    totalPrice: Math.round(totalPrice * 100) / 100,
  };
}

export function runAutoSeatSelection(
  allSeats: ResolvedSeat[],
  layout: ScreenLayoutV2,
  options: AutoSeatSelectOptions
): AutoSeatSelectResult {
  const exclude = options.excludeSeatIds ?? new Set<string>();
  const availablePool = allSeats.filter((s) => s.status === 'AVAILABLE' && !exclude.has(s.id));
  const totalAvailableCount = availablePool.length;
  const candidateOffset = options.candidateOffset ?? 0;

  // Mode A: Category-wise Selection (either per-category quantities map OR specificCategoryId)
  if (options.mode === 'CATEGORY') {
    const qtyMap = options.categoryQuantities ?? {};
    const entries = Object.entries(qtyMap).filter(([, q]) => Number(q) > 0);

    if (entries.length > 0) {
      const requestedTotal = entries.reduce((sum, [, q]) => sum + Math.floor(Number(q)), 0);
      if (requestedTotal > totalAvailableCount) {
        return {
          ok: false,
          error: `Only ${totalAvailableCount} seats are currently available. Please enter a quantity of ${totalAvailableCount} or less.`,
          ...summarizeSeatSelection([], totalAvailableCount, requestedTotal),
          candidateCount: 0,
          appliedCandidateIndex: 0,
        };
      }

      const combinedSeats: ResolvedSeat[] = [];
      const usedIds = new Set<string>();
      let minCandidates = Number.MAX_SAFE_INTEGER;

      for (const [catId, rawQty] of entries) {
        const qty = Math.floor(Number(rawQty));
        const catPool = availablePool.filter((s) => s.category_id === catId && !usedIds.has(s.id));
        const catMeta = layout.categories.find((c) => c.id === catId);
        const catName = catMeta?.name || catId;

        if (qty > catPool.length) {
          return {
            ok: false,
            error: `Only ${catPool.length} seats are currently available in ${catName}. Please enter a quantity of ${catPool.length} or less.`,
            ...summarizeSeatSelection([], totalAvailableCount, requestedTotal),
            candidateCount: 0,
            appliedCandidateIndex: 0,
          };
        }

        const res = selectExactFromPool(catPool, qty, layout, {
          sameRowPriority: options.sameRowPriority,
          adjacentSeatsPriority: options.adjacentSeatsPriority,
          centreSeatsPriority: options.centreSeatsPriority,
          rowZone: options.rowZone,
          allowMultipleRows: options.allowMultipleRows,
          candidateOffset,
        });

        if (!res.ok) {
          return {
            ok: false,
            error: `${catName}: ${res.error}`,
            ...summarizeSeatSelection([], totalAvailableCount, requestedTotal),
            candidateCount: 0,
            appliedCandidateIndex: 0,
          };
        }

        for (const s of res.seats) {
          usedIds.add(s.id);
          combinedSeats.push(s);
        }
        minCandidates = Math.min(minCandidates, res.candidateCount);
      }

      return {
        ok: true,
        ...summarizeSeatSelection(combinedSeats, totalAvailableCount, requestedTotal),
        candidateCount: minCandidates === Number.MAX_SAFE_INTEGER ? 1 : minCandidates,
        appliedCandidateIndex: candidateOffset,
      };
    }

    // Fallback: single chosen category using totalQuantity
    const targetPool =
      options.specificCategoryId && options.specificCategoryId !== 'ALL'
        ? availablePool.filter((s) => s.category_id === options.specificCategoryId)
        : availablePool;

    const qty = Math.floor(Number(options.totalQuantity) || 0);
    if (qty <= 0) {
      return {
        ok: false,
        error: 'Enter at least 1 seat quantity in a category to auto-select.',
        ...summarizeSeatSelection([], totalAvailableCount, 0),
        candidateCount: 0,
        appliedCandidateIndex: 0,
      };
    }

    const res = selectExactFromPool(targetPool, qty, layout, {
      sameRowPriority: options.sameRowPriority,
      adjacentSeatsPriority: options.adjacentSeatsPriority,
      centreSeatsPriority: options.centreSeatsPriority,
      rowZone: options.rowZone,
      allowMultipleRows: options.allowMultipleRows,
      candidateOffset,
    });

    if (!res.ok) {
      return {
        ok: false,
        error: res.error,
        ...summarizeSeatSelection([], totalAvailableCount, qty),
        candidateCount: 0,
        appliedCandidateIndex: 0,
      };
    }

    return {
      ok: true,
      ...summarizeSeatSelection(res.seats, totalAvailableCount, qty),
      candidateCount: res.candidateCount,
      appliedCandidateIndex: res.appliedIndex,
    };
  }

  // Mode B: Mixed Category Selection (optionally narrowed if specificCategoryId !== 'ALL')
  const qty = Math.floor(Number(options.totalQuantity) || 0);
  const pool =
    options.specificCategoryId && options.specificCategoryId !== 'ALL'
      ? availablePool.filter((s) => s.category_id === options.specificCategoryId)
      : availablePool;

  const res = selectExactFromPool(pool, qty, layout, {
    sameRowPriority: options.sameRowPriority,
    adjacentSeatsPriority: options.adjacentSeatsPriority,
    centreSeatsPriority: options.centreSeatsPriority,
    rowZone: options.rowZone,
    allowMultipleRows: options.allowMultipleRows,
    candidateOffset,
  });

  if (!res.ok) {
    return {
      ok: false,
      error: res.error,
      ...summarizeSeatSelection([], totalAvailableCount, qty),
      candidateCount: 0,
      appliedCandidateIndex: 0,
    };
  }

  return {
    ok: true,
    ...summarizeSeatSelection(res.seats, totalAvailableCount, qty),
    candidateCount: res.candidateCount,
    appliedCandidateIndex: res.appliedIndex,
  };
}
