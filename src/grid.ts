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

function resolveAxisSpan(
  spec:
    | { start: number | "auto"; end: number | "auto" | `span ${number}` }
    | undefined,
  explicitTracks: number,
): { start: number; end: number } | null {
  if (!spec || spec.start === "auto") return null;
  let start = resolveLine(spec.start, explicitTracks);
  let end: number;
  if (spec.end === "auto") {
    end = start + 1;
  } else if (typeof spec.end === "number") {
    end = resolveLine(spec.end, explicitTracks);
  } else {
    end = start + parseInt(spec.end.slice(5), 10);
  }
  if (end < start) [start, end] = [end, start];
  if (end === start) end = start + 1;
  return { start, end };
}

export function resolvePlacements(
  items: NormalizedLayoutNode[],
  explicitCols: number,
  explicitRows: number,
): {
  placements: Map<string, GridPlacement>;
  colCount: number;
  rowCount: number;
} {
  const placements = new Map<string, GridPlacement>();
  let colCount = explicitCols;
  let rowCount = explicitRows;
  for (const item of items) {
    const col = resolveAxisSpan(item.gridColumn, explicitCols) ?? {
      start: 0,
      end: 1,
    };
    const row = resolveAxisSpan(item.gridRow, explicitRows) ?? {
      start: 0,
      end: 1,
    };
    placements.set(item.id, {
      colStart: col.start,
      colEnd: col.end,
      rowStart: row.start,
      rowEnd: row.end,
    });
    colCount = Math.max(colCount, col.end);
    rowCount = Math.max(rowCount, row.end);
  }
  return { placements, colCount, rowCount };
}

function parseFr(v: unknown): number | null {
  return typeof v === "string" && v.endsWith("fr") ? parseFloat(v) : null;
}

export function resolveTrackSizes(
  tracks: TrackSize[],
  count: number,
  gap: number,
  available: number | undefined,
  minContributions: number[],
  maxContributions: number[],
): number[] {
  const sizes: number[] = [];
  const limits: number[] = [];
  const factors: (number | null)[] = [];
  const stretchable: boolean[] = [];

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
    } else if (max === "min-content") {
      limit = minC;
    } else {
      limit = maxC;
      if (max === "auto") stretch = true;
    }
    if (limit < base) limit = base;

    sizes.push(base);
    limits.push(limit);
    factors.push(fr);
    stretchable.push(stretch);
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
    let growable: number[] = [];
    for (let i = 0; i < count; i++) {
      if (sizes[i] < limits[i]) growable.push(i);
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
  if (remaining > 0) {
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

export function trackOffsets(sizes: number[], gap: number): number[] {
  const offsets: number[] = [];
  let pos = 0;
  for (const size of sizes) {
    offsets.push(pos);
    pos += size + gap;
  }
  return offsets;
}

export function gridAreaSize(
  sizes: number[],
  start: number,
  end: number,
  gap: number,
): number {
  let total = 0;
  for (let i = start; i < end; i++) total += sizes[i] ?? 0;
  return total + gap * Math.max(0, end - start - 1);
}
