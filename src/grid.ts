import {
  NormalizedLayoutNode,
  TrackListEntry,
  TrackSize,
} from "./types.js";

export interface GridPlacement {
  colStart: number;
  colEnd: number;
  rowStart: number;
  rowEnd: number;
}

export interface GridLayoutInfo {
  colSizes: number[];
  rowSizes: number[];
  colOffsets: number[];
  rowOffsets: number[];
  placements: Map<string, GridPlacement>;
}

export function expandTrackList(
  entries: TrackListEntry[] | undefined,
): TrackSize[] {
  if (!entries) return [];
  const out: TrackSize[] = [];
  for (const entry of entries) {
    if (typeof entry === "object" && entry !== null && "repeat" in entry) {
      const times = typeof entry.repeat === "number" ? entry.repeat : 1;
      for (let i = 0; i < times; i++) out.push(...entry.tracks);
    } else {
      out.push(entry);
    }
  }
  return out;
}

// 1-based grid line → 0-based track boundary; negative lines count from the
// end of the explicit grid (N tracks have N+1 lines, so -1 → boundary N).
function resolveLine(line: number, explicitTracks: number): number {
  return line > 0 ? line - 1 : explicitTracks + 1 + line;
}

interface AxisSpec {
  start: number | null;
  span: number;
}

function resolveAxisSpec(
  spec:
    | { start: number | "auto"; end: number | "auto" | `span ${number}` }
    | undefined,
  explicitTracks: number,
): AxisSpec {
  if (!spec) return { start: null, span: 1 };
  const spanFromEnd =
    typeof spec.end === "string" && spec.end !== "auto"
      ? parseInt(spec.end.slice(5), 10)
      : null;
  if (spec.start === "auto") {
    if (typeof spec.end === "number") {
      const end = resolveLine(spec.end, explicitTracks);
      return { start: end - 1, span: 1 };
    }
    return { start: null, span: spanFromEnd ?? 1 };
  }
  let start = resolveLine(spec.start, explicitTracks);
  if (spanFromEnd !== null) return { start, span: spanFromEnd };
  if (spec.end === "auto" || typeof spec.end !== "number") {
    return { start, span: 1 };
  }
  let end = resolveLine(spec.end, explicitTracks);
  if (end < start) [start, end] = [end, start];
  if (end === start) end = start + 1;
  return { start, span: end - start };
}

class Occupancy {
  private rows: Set<number>[] = [];

  fits(col: number, row: number, colSpan: number, rowSpan: number): boolean {
    for (let r = row; r < row + rowSpan; r++) {
      const cells = this.rows[r];
      if (!cells) continue;
      for (let c = col; c < col + colSpan; c++) {
        if (cells.has(c)) return false;
      }
    }
    return true;
  }

  place(col: number, row: number, colSpan: number, rowSpan: number): void {
    for (let r = row; r < row + rowSpan; r++) {
      if (!this.rows[r]) this.rows[r] = new Set();
      for (let c = col; c < col + colSpan; c++) this.rows[r].add(c);
    }
  }
}

/**
 * Sparse auto-placement (CSS Grid §8.5). For row flow the inline axis is
 * columns; column flow transposes the axes.
 */
export function resolvePlacements(
  items: NormalizedLayoutNode[],
  explicitCols: number,
  explicitRows: number,
  flow: "row" | "column",
  dense = false,
): {
  placements: Map<string, GridPlacement>;
  colCount: number;
  rowCount: number;
} {
  const columnFlow = flow === "column";
  // In flow terms: "inline" = the axis the cursor advances along first.
  const explicitInline = columnFlow ? explicitRows : explicitCols;
  const explicitBlock = columnFlow ? explicitCols : explicitRows;

  interface Entry {
    id: string;
    inline: AxisSpec;
    block: AxisSpec;
  }
  const entries: Entry[] = items.map((item) => {
    const col = resolveAxisSpec(item.gridColumn, explicitCols);
    const row = resolveAxisSpec(item.gridRow, explicitRows);
    return {
      id: item.id,
      inline: columnFlow ? row : col,
      block: columnFlow ? col : row,
    };
  });

  const placed = new Map<string, { inline: number; block: number; entry: Entry }>();
  const occupancy = new Occupancy();
  let inlineCount = explicitInline;
  let blockCount = explicitBlock;

  // §8.5 step 2: the implicit inline-axis size counts every item's definite
  // position/span before any auto item is placed.
  for (const entry of entries) {
    inlineCount = Math.max(
      inlineCount,
      entry.inline.start !== null
        ? entry.inline.start + entry.inline.span
        : entry.inline.span,
    );
  }

  const commit = (entry: Entry, inline: number, block: number) => {
    occupancy.place(inline, block, entry.inline.span, entry.block.span);
    placed.set(entry.id, { inline, block, entry });
    inlineCount = Math.max(inlineCount, inline + entry.inline.span);
    blockCount = Math.max(blockCount, block + entry.block.span);
  };

  for (const entry of entries) {
    if (entry.inline.start !== null && entry.block.start !== null) {
      commit(entry, entry.inline.start, entry.block.start);
    }
  }

  // Items locked to a block-axis position: earliest inline slot in that row,
  // scanning past previously placed same-row items (sparse).
  const rowCursors = new Map<number, number>();
  for (const entry of entries) {
    if (entry.inline.start !== null || entry.block.start === null) continue;
    const block = entry.block.start;
    let inline = rowCursors.get(block) ?? 0;
    while (!occupancy.fits(inline, block, entry.inline.span, entry.block.span)) {
      inline++;
    }
    commit(entry, inline, block);
    rowCursors.set(block, inline + entry.inline.span);
  }

  let cursorInline = 0;
  let cursorBlock = 0;
  for (const entry of entries) {
    if (placed.has(entry.id)) continue;
    if (dense) {
      cursorInline = 0;
      cursorBlock = 0;
    }
    if (entry.inline.start !== null) {
      if (dense) {
        cursorInline = entry.inline.start;
      } else {
        if (entry.inline.start < cursorInline) cursorBlock++;
        cursorInline = entry.inline.start;
      }
      while (
        !occupancy.fits(
          cursorInline,
          cursorBlock,
          entry.inline.span,
          entry.block.span,
        )
      ) {
        cursorBlock++;
      }
      commit(entry, cursorInline, cursorBlock);
      cursorInline += entry.inline.span;
    } else {
      const limit = inlineCount;
      for (;;) {
        if (cursorInline + entry.inline.span > limit) {
          cursorInline = 0;
          cursorBlock++;
          continue;
        }
        if (
          occupancy.fits(
            cursorInline,
            cursorBlock,
            entry.inline.span,
            entry.block.span,
          )
        ) {
          commit(entry, cursorInline, cursorBlock);
          cursorInline += entry.inline.span;
          break;
        }
        cursorInline++;
      }
    }
  }

  const placements = new Map<string, GridPlacement>();
  for (const [id, p] of placed) {
    const colStart = columnFlow ? p.block : p.inline;
    const rowStart = columnFlow ? p.inline : p.block;
    const colSpan = columnFlow ? p.entry.block.span : p.entry.inline.span;
    const rowSpan = columnFlow ? p.entry.inline.span : p.entry.block.span;
    placements.set(id, {
      colStart,
      colEnd: colStart + colSpan,
      rowStart,
      rowEnd: rowStart + rowSpan,
    });
  }
  return {
    placements,
    colCount: columnFlow ? blockCount : inlineCount,
    rowCount: columnFlow ? inlineCount : blockCount,
  };
}

function parseFr(v: unknown): number | null {
  return typeof v === "string" && v.endsWith("fr") ? parseFloat(v) : null;
}

export interface TrackItemContribution {
  start: number;
  end: number;
  min: number;
  max: number;
}

export function resolveTrackSizes(
  tracks: TrackSize[],
  count: number,
  gap: number,
  available: number | undefined,
  items: TrackItemContribution[],
  stretchTracks = true,
): number[] {
  // Span-1 contributions feed intrinsic bases and growth limits directly.
  const minContributions = new Array<number>(count).fill(0);
  const maxContributions = new Array<number>(count).fill(0);
  const hasSpan1Item = new Array<boolean>(count).fill(false);
  for (const item of items) {
    if (item.end - item.start !== 1) continue;
    hasSpan1Item[item.start] = true;
    minContributions[item.start] = Math.max(
      minContributions[item.start],
      item.min,
    );
    maxContributions[item.start] = Math.max(
      maxContributions[item.start],
      item.max,
    );
  }

  const sizes: number[] = [];
  const limits: number[] = [];
  const factors: (number | null)[] = [];
  const stretchable: boolean[] = [];
  const intrinsicMin: boolean[] = [];
  const intrinsicMax: boolean[] = [];

  for (let i = 0; i < count; i++) {
    const t = tracks[i] ?? "auto";
    const minC = minContributions[i] ?? 0;
    const maxC = maxContributions[i] ?? 0;
    let min: number | "auto" | "min-content" | "max-content";
    let max: number | "auto" | "min-content" | "max-content" | `${number}fr`;
    if (typeof t === "number") {
      min = t;
      max = t;
    } else if (typeof t === "string") {
      if (parseFr(t) !== null) {
        min = "auto";
        max = t as `${number}fr`;
      } else {
        min = t as "auto" | "min-content" | "max-content";
        max = t as "auto" | "min-content" | "max-content";
      }
    } else {
      min = t.min;
      max = t.max;
    }

    const base =
      typeof min === "number" ? min : min === "max-content" ? maxC : minC;
    const fr = parseFr(max);
    let limit: number;
    let stretch = false;
    if (fr !== null) {
      // Flexible maxes don't grow in the maximize step; §12.7 handles them.
      limit = base;
    } else if (typeof max === "number") {
      limit = max;
    } else {
      // Intrinsic max with no span-1 item stays infinitely growable.
      if (!hasSpan1Item[i]) limit = Infinity;
      else if (max === "min-content") limit = minC;
      else limit = maxC;
      if (max === "auto") stretch = true;
    }
    if (limit < base) limit = base;

    sizes.push(base);
    limits.push(limit);
    factors.push(fr);
    stretchable.push(stretch);
    intrinsicMin.push(typeof min !== "number");
    intrinsicMax.push(fr === null && typeof max !== "number");
  }

  // §12.5 spanning items: ascending span groups; within a group each item
  // distributes its shortfall over the spanned intrinsic tracks against the
  // pre-group sizes, and the group applies the max planned increase per
  // track. Items spanning a flexible track contribute nothing.
  const spansFlex = (it: TrackItemContribution): boolean => {
    for (let i = it.start; i < it.end; i++) {
      if (factors[i] !== null) return true;
    }
    return false;
  };
  const spanItems = items
    .filter((it) => it.end - it.start > 1 && !spansFlex(it))
    .sort((a, b) => a.end - a.start - (b.end - b.start));
  let groupStart = 0;
  while (groupStart < spanItems.length) {
    const span =
      spanItems[groupStart].end - spanItems[groupStart].start;
    let groupEnd = groupStart;
    while (
      groupEnd < spanItems.length &&
      spanItems[groupEnd].end - spanItems[groupEnd].start === span
    ) {
      groupEnd++;
    }
    const plannedBase = new Map<number, number>();
    const plannedLimit = new Map<number, number>();
    for (let k = groupStart; k < groupEnd; k++) {
      const item = spanItems[k];
      const innerGaps = gap * (span - 1);

      let baseSum = innerGaps;
      for (let i = item.start; i < item.end; i++) baseSum += sizes[i];
      const baseExtra = item.min - baseSum;
      const targets: number[] = [];
      for (let i = item.start; i < item.end; i++) {
        if (intrinsicMin[i]) targets.push(i);
      }
      if (baseExtra > 0 && targets.length > 0) {
        // Fill tracks that still have room below their growth limits first;
        // only grow saturated tracks beyond their limits with the remainder.
        const inc = new Map<number, number>();
        let remaining = baseExtra;
        let open = targets.filter((i) => sizes[i] < limits[i]);
        while (remaining > 1e-9 && open.length > 0) {
          const share = remaining / open.length;
          let progressed = false;
          for (const i of open) {
            const used = inc.get(i) ?? 0;
            const room =
              limits[i] === Infinity ? Infinity : limits[i] - sizes[i] - used;
            const grow = Math.min(share, room);
            if (grow > 0) {
              inc.set(i, used + grow);
              remaining -= grow;
              progressed = true;
            }
          }
          open = open.filter((i) => {
            const used = inc.get(i) ?? 0;
            return limits[i] === Infinity || sizes[i] + used < limits[i] - 1e-9;
          });
          if (!progressed) break;
        }
        if (remaining > 1e-9) {
          const each = remaining / targets.length;
          for (const i of targets) inc.set(i, (inc.get(i) ?? 0) + each);
        }
        for (const [i, v] of inc) {
          plannedBase.set(i, Math.max(plannedBase.get(i) ?? 0, v));
        }
      }

      // An infinitely growable spanned track absorbs the item on its own;
      // growth limits only need distribution when every spanned limit is finite.
      let limitSum = innerGaps;
      let hasInfinite = false;
      for (let i = item.start; i < item.end; i++) {
        if (limits[i] === Infinity) hasInfinite = true;
        limitSum += limits[i];
      }
      const limitExtra = item.max - limitSum;
      if (!hasInfinite && limitExtra > 0) {
        const targets: number[] = [];
        for (let i = item.start; i < item.end; i++) {
          if (intrinsicMax[i]) targets.push(i);
        }
        if (targets.length > 0) {
          const share = limitExtra / targets.length;
          for (const i of targets) {
            plannedLimit.set(i, Math.max(plannedLimit.get(i) ?? 0, share));
          }
        }
      }
    }
    for (const [i, inc] of plannedBase) sizes[i] += inc;
    for (const [i, inc] of plannedLimit) limits[i] += inc;
    for (let i = 0; i < count; i++) {
      if (limits[i] < sizes[i]) limits[i] = sizes[i];
    }
    groupStart = groupEnd;
  }

  // §12.5.1 step 4: items spanning a flexible track distribute their minimum
  // contribution (beyond non-flex bases and gaps) to the spanned flex tracks,
  // proportional to flex factors. Growth limits are untouched.
  const plannedFlexBase = new Map<number, number>();
  for (const item of items) {
    if (item.end - item.start <= 1 || !spansFlex(item)) continue;
    let nonFlexSum = gap * (item.end - item.start - 1);
    let sumF = 0;
    for (let i = item.start; i < item.end; i++) {
      if (factors[i] === null) nonFlexSum += sizes[i];
      else sumF += factors[i]!;
    }
    const extra = item.min - nonFlexSum;
    if (extra <= 0 || sumF <= 0) continue;
    for (let i = item.start; i < item.end; i++) {
      if (factors[i] !== null) {
        const share = (extra * factors[i]!) / sumF;
        plannedFlexBase.set(i, Math.max(plannedFlexBase.get(i) ?? 0, share));
      }
    }
  }
  for (const [i, v] of plannedFlexBase) {
    sizes[i] = Math.max(sizes[i], v);
    if (limits[i] < sizes[i]) limits[i] = sizes[i];
  }

  const flexIndices: number[] = [];
  for (let i = 0; i < count; i++) {
    if (factors[i] !== null) flexIndices.push(i);
  }

  if (available === undefined) {
    // Indefinite space: no maximize/stretch; fr unit is the max of
    // base/factor over the flexible tracks (factors below 1 treated as 1).
    let frUnit = 0;
    for (const i of flexIndices) {
      const f = factors[i]!;
      if (f > 0) frUnit = Math.max(frUnit, sizes[i] / Math.max(f, 1));
    }
    for (const i of flexIndices) {
      sizes[i] = Math.max(sizes[i], frUnit * factors[i]!);
    }
    return sizes;
  }

  const innerSpace = available - gap * Math.max(0, count - 1);

  // §12.6 maximize: equal shares up to growth limits
  let free = innerSpace;
  for (let i = 0; i < count; i++) free -= sizes[i];
  if (free > 0) {
    // An infinite growth limit is treated as the base size here (§12.6).
    let growable: number[] = [];
    for (let i = 0; i < count; i++) {
      if (limits[i] !== Infinity && sizes[i] < limits[i]) growable.push(i);
    }
    while (free > 1e-9 && growable.length > 0) {
      const share = free / growable.length;
      const next: number[] = [];
      for (const i of growable) {
        const grow = Math.min(share, limits[i] - sizes[i]);
        sizes[i] += grow;
        free -= grow;
        if (sizes[i] < limits[i] - 1e-9) next.push(i);
      }
      if (next.length === growable.length) break;
      growable = next;
    }
  }

  // §12.7 expand flexible tracks, treating bases as content minimums
  if (flexIndices.length > 0) {
    let leftover = innerSpace;
    for (let i = 0; i < count; i++) {
      if (factors[i] === null) leftover -= sizes[i];
    }
    const frozen = new Set<number>();
    for (;;) {
      let sumFactors = 0;
      let flexFree = leftover;
      for (const i of flexIndices) {
        if (frozen.has(i)) flexFree -= sizes[i];
        else sumFactors += factors[i]!;
      }
      if (sumFactors === 0) break;
      const denom = Math.max(sumFactors, 1);
      let refroze = false;
      for (const i of flexIndices) {
        if (frozen.has(i)) continue;
        if ((flexFree * factors[i]!) / denom < sizes[i]) {
          frozen.add(i);
          refroze = true;
        }
      }
      if (!refroze) {
        for (const i of flexIndices) {
          if (!frozen.has(i)) sizes[i] = (flexFree * factors[i]!) / denom;
        }
        break;
      }
    }
  }

  // Content-distribution stretch: leftover free space goes equally to
  // auto-max tracks, ignoring growth limits.
  let remaining = innerSpace;
  for (let i = 0; i < count; i++) remaining -= sizes[i];
  if (remaining > 0 && stretchTracks) {
    const stretchIndices: number[] = [];
    for (let i = 0; i < count; i++) {
      if (stretchable[i]) stretchIndices.push(i);
    }
    if (stretchIndices.length > 0) {
      const each = remaining / stretchIndices.length;
      for (const i of stretchIndices) sizes[i] += each;
    }
  }

  return sizes;
}

export type ContentDistribution =
  | "flex-start"
  | "flex-end"
  | "center"
  | "space-between"
  | "space-around"
  | "space-evenly"
  | "stretch";

/**
 * Track offsets under justify-content/align-content. Free space distributes
 * between tracks (or as a leading offset); stretch/normal was already absorbed
 * into auto tracks during sizing.
 */
export function trackOffsets(
  sizes: number[],
  gap: number,
  available?: number,
  distribution?: ContentDistribution,
): number[] {
  let lead = 0;
  let extra = 0;
  const n = sizes.length;
  if (available !== undefined && distribution !== undefined && n > 0) {
    let free = available - gap * Math.max(0, n - 1);
    for (const s of sizes) free -= s;
    switch (distribution) {
      case "flex-end":
        lead = free;
        break;
      case "center":
        lead = free / 2;
        break;
      case "space-between":
        if (free > 0 && n > 1) extra = free / (n - 1);
        break;
      case "space-around":
        if (free > 0) {
          extra = free / n;
          lead = extra / 2;
        }
        break;
      case "space-evenly":
        if (free > 0) {
          extra = free / (n + 1);
          lead = extra;
        }
        break;
      default:
        break;
    }
  }
  const offsets: number[] = [];
  let pos = lead;
  for (const size of sizes) {
    offsets.push(pos);
    pos += size + gap + extra;
  }
  return offsets;
}

export type GridItemAlignment = "start" | "end" | "center" | "stretch";

export function gridItemJustify(
  child: NormalizedLayoutNode,
  container: NormalizedLayoutNode,
): GridItemAlignment {
  return child.justifySelf && child.justifySelf !== "auto"
    ? child.justifySelf
    : (container.justifyItems ?? "stretch");
}

export function gridItemAlign(
  child: NormalizedLayoutNode,
  container: NormalizedLayoutNode,
): GridItemAlignment {
  const raw =
    child.alignSelf && child.alignSelf !== "auto"
      ? child.alignSelf
      : (container.alignItems ?? "stretch");
  switch (raw) {
    case "flex-start":
    case "baseline":
      return "start";
    case "flex-end":
      return "end";
    default:
      return raw;
  }
}

