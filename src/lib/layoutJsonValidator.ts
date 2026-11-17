import type { LayoutValidationIssue, ScreenLayoutV2 } from '../types';

export interface DetailedLayoutValidationResult {
  valid: boolean;
  issues: LayoutValidationIssue[];
  errors: string[];
  warnings: string[];
  parsed?: ScreenLayoutV2;
  summary?: {
    schema_version: string;
    theatre_id: string;
    theatre_name: string;
    screen_id: string;
    screen_name: string;
    dimensions: string;
    categories_count: number;
    rows_count: number;
    seats_count: number;
    aisles_count: number;
    blocked_seats_count: number;
  };
}

const VALID_SEAT_TYPES = new Set(['NORMAL', 'COUPLE', 'RECLINER', 'SOFA', 'WHEELCHAIR']);
const VALID_BLOCKS = new Set(['LEFT', 'CENTRE', 'RIGHT']);
const VALID_SEAT_STATUSES = new Set(['AVAILABLE', 'OCCUPIED', 'BLOCKED', 'LOCKED', 'DISABLED']);

function indexToLine(text: string, index: number): number {
  let line = 1;
  const limit = Math.min(index, text.length);
  for (let i = 0; i < limit; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function findTopLevelKeyLine(lines: string[], key: string): number {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`"${escaped}"\\s*:`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i + 1;
  }
  return 1;
}

function findArrayItemRange(
  lines: string[],
  arrayKey: string,
  itemIndex: number
): { startLine: number; endLine: number } {
  const arrLine = findTopLevelKeyLine(lines, arrayKey);
  let braceDepth = 0;
  let inArray = false;
  let currentItem = -1;
  let itemStart = arrLine;

  for (let i = arrLine - 1; i < lines.length; i++) {
    const text = lines[i];
    for (let c = 0; c < text.length; c++) {
      const ch = text[c];
      if (!inArray) {
        if (ch === '[') inArray = true;
        continue;
      }
      if (ch === '{') {
        if (braceDepth === 0) {
          currentItem++;
          if (currentItem === itemIndex) {
            itemStart = i + 1;
          }
        }
        braceDepth++;
      } else if (ch === '}') {
        braceDepth--;
        if (braceDepth === 0 && currentItem === itemIndex) {
          return { startLine: itemStart, endLine: i + 1 };
        }
      } else if (ch === ']' && braceDepth === 0) {
        return { startLine: arrLine, endLine: i + 1 };
      }
    }
  }
  return { startLine: arrLine, endLine: arrLine };
}

function findKeyInLineRange(lines: string[], startLine: number, endLine: number, key: string): number {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`"${escaped}"\\s*:`);
  const s = Math.max(0, startLine - 1);
  const e = Math.min(lines.length - 1, endLine - 1);
  for (let i = s; i <= e; i++) {
    if (re.test(lines[i])) return i + 1;
  }
  return startLine;
}

function extractSyntaxErrorLine(rawText: string, message: string): number {
  const lineColMatch = message.match(/line\s+(\d+)/i);
  if (lineColMatch) {
    return Math.max(1, parseInt(lineColMatch[1], 10));
  }
  const posMatch = message.match(/position\s+(\d+)/i);
  if (posMatch) {
    return indexToLine(rawText, parseInt(posMatch[1], 10));
  }
  return 1;
}

export function validateScreenLayoutObject(
  raw: unknown,
  options: { requireBlockedSeats?: boolean; rawLines?: string[] } = {}
): DetailedLayoutValidationResult {
  const { requireBlockedSeats = false, rawLines = [] } = options;
  const issues: LayoutValidationIssue[] = [];
  const warnings: string[] = [];

  const lineForKey = (key: string): number =>
    rawLines.length > 0 ? findTopLevelKeyLine(rawLines, key) : 1;

  const lineForItemKey = (arrayKey: string, idx: number, fieldKey?: string): number => {
    if (rawLines.length === 0) return 1;
    const range = findArrayItemRange(rawLines, arrayKey, idx);
    if (!fieldKey) return range.startLine;
    return findKeyInLineRange(rawLines, range.startLine, range.endLine, fieldKey);
  };

  const pushIssue = (line: number, field: string, message: string) => {
    issues.push({ line, field, message });
  };

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    pushIssue(1, 'root', 'Layout root must be a valid JSON object.');
    return { valid: false, issues, errors: issues.map((i) => `Line ${i.line}: ${i.message}`), warnings };
  }

  const obj = raw as Record<string, unknown>;

  // 1. Schema version
  if (obj.schema_version !== '2.0') {
    pushIssue(lineForKey('schema_version'), 'schema_version', 'schema_version must be "2.0".');
  }

  // 2. Theatre ID & Screen ID
  if (typeof obj.theatre_id !== 'string' || !obj.theatre_id.trim()) {
    pushIssue(lineForKey('theatre_id'), 'theatre_id', 'theatre_id is required and must be a non-empty string.');
  }
  if (typeof obj.theatre_name !== 'string' || !obj.theatre_name.trim()) {
    pushIssue(lineForKey('theatre_name'), 'theatre_name', 'theatre_name is required and must be a non-empty string.');
  }
  if (typeof obj.screen_id !== 'string' || !obj.screen_id.trim()) {
    pushIssue(lineForKey('screen_id'), 'screen_id', 'screen_id is required and must be a non-empty string.');
  }
  if (typeof obj.screen_name !== 'string' || !obj.screen_name.trim()) {
    pushIssue(lineForKey('screen_name'), 'screen_name', 'screen_name is required and must be a non-empty string.');
  }

  // 3. Canvas Dimensions & Direction
  if (typeof obj.screen_width !== 'number' || Number.isNaN(obj.screen_width) || obj.screen_width < 200) {
    pushIssue(lineForKey('screen_width'), 'screen_width', 'screen_width must be a number >= 200.');
  }
  if (typeof obj.screen_height !== 'number' || Number.isNaN(obj.screen_height) || obj.screen_height < 200) {
    pushIssue(lineForKey('screen_height'), 'screen_height', 'screen_height must be a number >= 200.');
  }
  if (obj.screen_direction !== 'BOTTOM' && obj.screen_direction !== 'TOP') {
    pushIssue(lineForKey('screen_direction'), 'screen_direction', 'screen_direction must be either "BOTTOM" or "TOP".');
  }
  if (obj.coordinate_system !== 'cartesian_px') {
    pushIssue(
      lineForKey('coordinate_system'),
      'coordinate_system',
      'coordinate_system must be "cartesian_px".'
    );
  }

  // 4. Aisles array validation ("aisles": [])
  if (!Array.isArray(obj.aisles)) {
    pushIssue(
      lineForKey('aisles'),
      'aisles',
      'aisles must ALWAYS be a valid JSON array (use "aisles": [] when there are no aisles).'
    );
  } else {
    obj.aisles.forEach((aisle: unknown, idx: number) => {
      const a = aisle as Record<string, unknown>;
      if (!a || typeof a !== 'object') {
        pushIssue(lineForItemKey('aisles', idx), `aisles[${idx}]`, `aisles[${idx}] must be an object.`);
        return;
      }
      if (typeof a.id !== 'string' || !a.id.trim()) {
        pushIssue(lineForItemKey('aisles', idx, 'id'), `aisles[${idx}].id`, `aisles[${idx}].id must be a non-empty string.`);
      }
      if (a.orientation !== 'vertical' && a.orientation !== 'horizontal') {
        pushIssue(
          lineForItemKey('aisles', idx, 'orientation'),
          `aisles[${idx}].orientation`,
          `aisles[${idx}].orientation must be "vertical" or "horizontal".`
        );
      }
      if (
        typeof a.x !== 'number' ||
        typeof a.y !== 'number' ||
        typeof a.width !== 'number' ||
        typeof a.height !== 'number' ||
        a.width <= 0 ||
        a.height <= 0
      ) {
        pushIssue(
          lineForItemKey('aisles', idx, 'x'),
          `aisles[${idx}]`,
          `aisles[${idx}] must have numeric x, y, and positive width and height.`
        );
      }
    });
  }

  // 5. Blocked seats array validation ("blocked_seats": [])
  if (obj.blocked_seats === undefined) {
    if (requireBlockedSeats) {
      pushIssue(
        lineForKey('blocked_seats'),
        'blocked_seats',
        'blocked_seats is required and must be a valid array (use "blocked_seats": [] when none are blocked).'
      );
    }
  } else if (!Array.isArray(obj.blocked_seats)) {
    pushIssue(
      lineForKey('blocked_seats'),
      'blocked_seats',
      'blocked_seats must ALWAYS be a valid JSON array (use "blocked_seats": [] when empty).'
    );
  } else {
    obj.blocked_seats.forEach((entry: unknown, idx: number) => {
      if (typeof entry !== 'string' || !entry.trim()) {
        pushIssue(
          lineForKey('blocked_seats'),
          `blocked_seats[${idx}]`,
          `blocked_seats[${idx}] must be a valid non-empty seat ID string.`
        );
      }
    });
  }

  // 6. Categories and category IDs
  const categoryIds = new Set<string>();
  if (!Array.isArray(obj.categories) || obj.categories.length === 0) {
    pushIssue(lineForKey('categories'), 'categories', 'categories must be a non-empty array.');
  } else {
    obj.categories.forEach((cat: unknown, idx: number) => {
      const c = cat as Record<string, unknown>;
      if (!c || typeof c !== 'object') {
        pushIssue(lineForItemKey('categories', idx), `categories[${idx}]`, `categories[${idx}] must be an object.`);
        return;
      }
      if (typeof c.id !== 'string' || !c.id.trim()) {
        pushIssue(
          lineForItemKey('categories', idx, 'id'),
          `categories[${idx}].id`,
          `categories[${idx}].id must be a non-empty string.`
        );
      } else if (categoryIds.has(c.id)) {
        pushIssue(
          lineForItemKey('categories', idx, 'id'),
          `categories[${idx}].id`,
          `Duplicate category id "${c.id}" found at categories[${idx}].`
        );
      } else {
        categoryIds.add(c.id);
      }
      if (typeof c.name !== 'string' || !c.name.trim()) {
        pushIssue(
          lineForItemKey('categories', idx, 'name'),
          `categories[${idx}].name`,
          `categories[${idx}].name must be a non-empty string.`
        );
      }
      if (typeof c.color !== 'string' || !c.color.trim()) {
        pushIssue(
          lineForItemKey('categories', idx, 'color'),
          `categories[${idx}].color`,
          `categories[${idx}].color must be a valid CSS color string.`
        );
      }
      if (typeof c.price !== 'number' || Number.isNaN(c.price) || c.price < 0) {
        pushIssue(
          lineForItemKey('categories', idx, 'price'),
          `categories[${idx}].price`,
          `categories[${idx}].price must be a non-negative number.`
        );
      }
      if (!Array.isArray(c.rows)) {
        pushIssue(
          lineForItemKey('categories', idx, 'rows'),
          `categories[${idx}].rows`,
          `categories[${idx}].rows must be an array of row labels.`
        );
      }
    });
  }

  // 7. Rows validation
  const rowLabels = new Set<string>();
  if (!Array.isArray(obj.rows) || obj.rows.length === 0) {
    pushIssue(lineForKey('rows'), 'rows', 'rows must be a non-empty array.');
  } else {
    obj.rows.forEach((row: unknown, idx: number) => {
      const r = row as Record<string, unknown>;
      if (!r || typeof r !== 'object') {
        pushIssue(lineForItemKey('rows', idx), `rows[${idx}]`, `rows[${idx}] must be an object.`);
        return;
      }
      const rowKey = typeof r.label === 'string' && r.label.trim() ? r.label : typeof r.id === 'string' && r.id.trim() ? r.id : '';
      if (!rowKey) {
        pushIssue(
          lineForItemKey('rows', idx, 'label'),
          `rows[${idx}].label`,
          `rows[${idx}].label (row ID) must be a non-empty string.`
        );
      } else if (rowLabels.has(rowKey)) {
        pushIssue(
          lineForItemKey('rows', idx, 'label'),
          `rows[${idx}].label`,
          `Duplicate row label "${rowKey}" found at rows[${idx}].`
        );
      } else {
        rowLabels.add(rowKey);
      }
      if (typeof r.y !== 'number' || Number.isNaN(r.y) || r.y < 0) {
        pushIssue(lineForItemKey('rows', idx, 'y'), `rows[${idx}].y`, `rows[${idx}].y must be a non-negative number.`);
      }
      if (typeof r.category_id !== 'string' || (categoryIds.size > 0 && !categoryIds.has(r.category_id))) {
        pushIssue(
          lineForItemKey('rows', idx, 'category_id'),
          `rows[${idx}].category_id`,
          `rows[${idx}].category_id "${String(r.category_id)}" does not match any defined category.`
        );
      }
    });
  }

  // 8. Seats validation (IDs, duplicates, coordinates, dimensions, category, type, block, status)
  const seatIds = new Set<string>();
  if (!Array.isArray(obj.seats) || obj.seats.length === 0) {
    pushIssue(lineForKey('seats'), 'seats', 'seats must be a non-empty array.');
  } else {
    obj.seats.forEach((seat: unknown, idx: number) => {
      const s = seat as Record<string, unknown>;
      if (!s || typeof s !== 'object') {
        pushIssue(lineForItemKey('seats', idx), `seats[${idx}]`, `seats[${idx}] must be an object.`);
        return;
      }
      if (typeof s.id !== 'string' || !s.id.trim()) {
        pushIssue(lineForItemKey('seats', idx, 'id'), `seats[${idx}].id`, `seats[${idx}].id is required.`);
      } else if (seatIds.has(s.id)) {
        pushIssue(
          lineForItemKey('seats', idx, 'id'),
          `seats[${idx}].id`,
          `Duplicate seat id "${s.id}" found at seats[${idx}].`
        );
      } else {
        seatIds.add(s.id);
      }

      if (typeof s.row !== 'string' || !s.row.trim()) {
        pushIssue(lineForItemKey('seats', idx, 'row'), `seats[${idx}].row`, `seats[${idx}].row is required.`);
      } else if (rowLabels.size > 0 && !rowLabels.has(s.row)) {
        pushIssue(
          lineForItemKey('seats', idx, 'row'),
          `seats[${idx}].row`,
          `seats[${idx}].row "${s.row}" does not match any row defined in rows[].`
        );
      }

      if (typeof s.number !== 'number' || Number.isNaN(s.number) || s.number < 1) {
        pushIssue(
          lineForItemKey('seats', idx, 'number'),
          `seats[${idx}].number`,
          `seats[${idx}].number must be a positive number.`
        );
      }

      if (typeof s.x !== 'number' || Number.isNaN(s.x) || s.x < 0 || typeof s.y !== 'number' || Number.isNaN(s.y) || s.y < 0) {
        pushIssue(
          lineForItemKey('seats', idx, 'x'),
          `seats[${idx}].x/y`,
          `seats[${idx}] (${String(s.id || idx)}) must include non-negative numeric x and y coordinates.`
        );
      }

      if (
        typeof s.width !== 'number' ||
        Number.isNaN(s.width) ||
        s.width <= 0 ||
        typeof s.height !== 'number' ||
        Number.isNaN(s.height) ||
        s.height <= 0
      ) {
        pushIssue(
          lineForItemKey('seats', idx, 'width'),
          `seats[${idx}].width/height`,
          `seats[${idx}] (${String(s.id || idx)}) must include positive numeric width and height dimensions.`
        );
      }

      if (typeof s.category_id !== 'string' || (categoryIds.size > 0 && !categoryIds.has(s.category_id))) {
        pushIssue(
          lineForItemKey('seats', idx, 'category_id'),
          `seats[${idx}].category_id`,
          `seats[${idx}].category_id "${String(s.category_id)}" does not match any defined category.`
        );
      }

      if (typeof s.seat_type !== 'string' || !VALID_SEAT_TYPES.has(s.seat_type)) {
        pushIssue(
          lineForItemKey('seats', idx, 'seat_type'),
          `seats[${idx}].seat_type`,
          `seats[${idx}].seat_type "${String(s.seat_type)}" must be one of NORMAL, COUPLE, RECLINER, SOFA, WHEELCHAIR.`
        );
      }

      if (typeof s.block !== 'string' || !VALID_BLOCKS.has(s.block)) {
        pushIssue(
          lineForItemKey('seats', idx, 'block'),
          `seats[${idx}].block`,
          `seats[${idx}].block "${String(s.block)}" must be LEFT, CENTRE, or RIGHT.`
        );
      }

      if (s.status !== undefined && (typeof s.status !== 'string' || !VALID_SEAT_STATUSES.has(s.status))) {
        pushIssue(
          lineForItemKey('seats', idx, 'status'),
          `seats[${idx}].status`,
          `seats[${idx}].status "${String(s.status)}" must be AVAILABLE, OCCUPIED, BLOCKED, LOCKED, or DISABLED.`
        );
      }

      if (
        s.price_override !== undefined &&
        s.price_override !== null &&
        (typeof s.price_override !== 'number' || Number.isNaN(s.price_override) || s.price_override < 0)
      ) {
        pushIssue(
          lineForItemKey('seats', idx, 'price_override'),
          `seats[${idx}].price_override`,
          `seats[${idx}].price_override must be null or a non-negative number.`
        );
      }
    });
  }

  // Verify blocked_seats references exist in seats[]
  if (Array.isArray(obj.blocked_seats) && seatIds.size > 0) {
    obj.blocked_seats.forEach((seatId: unknown, idx: number) => {
      if (typeof seatId === 'string' && seatId.trim() && !seatIds.has(seatId)) {
        pushIssue(
          lineForKey('blocked_seats'),
          `blocked_seats[${idx}]`,
          `blocked_seats[${idx}] references seat "${seatId}" which does not exist in seats[].`
        );
      }
    });
  }

  if (issues.length > 0) {
    return {
      valid: false,
      issues,
      errors: issues.map((i) => `Line ${i.line} (${i.field}): ${i.message}`),
      warnings,
    };
  }

  // IMPORTANT: Preserve the exact uploaded JSON without silently modifying coordinates, IDs, categories, or fields.
  const exactParsed = obj as unknown as ScreenLayoutV2;

  return {
    valid: true,
    issues: [],
    errors: [],
    warnings,
    parsed: exactParsed,
    summary: {
      schema_version: exactParsed.schema_version,
      theatre_id: exactParsed.theatre_id,
      theatre_name: exactParsed.theatre_name,
      screen_id: exactParsed.screen_id,
      screen_name: exactParsed.screen_name,
      dimensions: `${exactParsed.screen_width} × ${exactParsed.screen_height} px`,
      categories_count: exactParsed.categories.length,
      rows_count: exactParsed.rows.length,
      seats_count: exactParsed.seats.length,
      aisles_count: exactParsed.aisles.length,
      blocked_seats_count: Array.isArray(exactParsed.blocked_seats) ? exactParsed.blocked_seats.length : 0,
    },
  };
}

export function validateScreenLayoutJsonText(
  rawText: string,
  options: { requireBlockedSeats?: boolean } = { requireBlockedSeats: true }
): DetailedLayoutValidationResult {
  if (!rawText || !rawText.trim()) {
    const issue: LayoutValidationIssue = { line: 1, field: 'file', message: 'Uploaded JSON file is empty.' };
    return { valid: false, issues: [issue], errors: [`Line 1: ${issue.message}`], warnings: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    const msg = (err as Error).message || 'Invalid JSON syntax.';
    const line = extractSyntaxErrorLine(rawText, msg);
    const issue: LayoutValidationIssue = {
      line,
      field: 'syntax',
      message: `JSON syntax error: ${msg}`,
    };
    return { valid: false, issues: [issue], errors: [`Line ${line}: ${issue.message}`], warnings: [] };
  }

  const rawLines = rawText.split(/\r?\n/);
  return validateScreenLayoutObject(parsed, {
    requireBlockedSeats: options.requireBlockedSeats ?? true,
    rawLines,
  });
}
