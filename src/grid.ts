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

function trackFlexFactor(t: TrackSize | undefined): number | null {
  if (typeof t === "string" && t.endsWith("fr")) return parseFloat(t);
  if (
    typeof t === "object" &&
    t !== null &&
    typeof t.max === "string" &&
    t.max.endsWith("fr")
  ) {
    return parseFloat(t.max);
  }
  return null;
}

export function resolveTrackSizes(
  tracks: TrackSize[],
  count: number,
  gap: number,
  available: number | undefined,
  contributions: number[],
): number[] {
  const sizes: number[] = [];
  const flexIndices: number[] = [];
  const factors: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = tracks[i];
    const fr = trackFlexFactor(t);
    if (typeof t === "number") {
      sizes.push(t);
    } else {
      sizes.push(contributions[i] ?? 0);
      if (fr !== null) {
        flexIndices.push(i);
        factors.push(fr);
      }
    }
  }
  if (flexIndices.length === 0) return sizes;

  if (available === undefined) {
    // Indefinite space: the used fr unit is the max of base/factor over the
    // flexible tracks (factors below 1 treated as 1), so every fr track fits
    // its content at that unit.
    let frUnit = 0;
    for (let k = 0; k < flexIndices.length; k++) {
      if (factors[k] > 0) {
        frUnit = Math.max(
          frUnit,
          sizes[flexIndices[k]] / Math.max(factors[k], 1),
        );
      }
    }
    for (let k = 0; k < flexIndices.length; k++) {
      sizes[flexIndices[k]] = Math.max(
        sizes[flexIndices[k]],
        frUnit * factors[k],
      );
    }
    return sizes;
  }

  let leftover = available - gap * Math.max(0, count - 1);
  for (let i = 0; i < count; i++) {
    if (!flexIndices.includes(i)) leftover -= sizes[i];
  }
  const frozen = new Set<number>();
  for (;;) {
    let sumFactors = 0;
    let free = leftover;
    for (let k = 0; k < flexIndices.length; k++) {
      if (frozen.has(k)) free -= sizes[flexIndices[k]];
      else sumFactors += factors[k];
    }
    if (sumFactors === 0) break;
    const denom = Math.max(sumFactors, 1);
    let refroze = false;
    for (let k = 0; k < flexIndices.length; k++) {
      if (frozen.has(k)) continue;
      if ((free * factors[k]) / denom < sizes[flexIndices[k]]) {
        frozen.add(k);
        refroze = true;
      }
    }
    if (!refroze) {
      for (let k = 0; k < flexIndices.length; k++) {
        if (!frozen.has(k)) {
          sizes[flexIndices[k]] = (free * factors[k]) / denom;
        }
      }
      break;
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
