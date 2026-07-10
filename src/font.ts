/**
 * Zero-dependency TTF/OTF metrics: parse a font file into per-glyph advances
 * and turn a string into a `measureContent` callback without a browser.
 *
 * Advances are unshaped and unkerned — the plain per-glyph sum of `hmtx`
 * widths, with no GSUB/GPOS applied. This matches Chromium rendered with
 * `font-kerning: none` and ligatures disabled; with default shaping Chromium
 * can come out narrower on kerned pairs and ligature clusters.
 *
 * Supports TrueType (`0x00010000`, `"true"`) and CFF-flavoured OpenType
 * (`"OTTO"`); the tables read are `head`, `cmap` (formats 4 and 12), `hhea`,
 * and `hmtx`, so a CFF outline table is never touched. TrueType Collections
 * and fonts whose only cmap subtable is format 0 are rejected.
 */

import { measureFromAdvances, type MeasureContent } from "./text.js";

export interface FontMetrics {
  unitsPerEm: number;
  /** hhea ascender, font units. */
  ascent: number;
  /** Positive magnitude of the hhea descender, font units. */
  descent: number;
  lineGap: number;
  /** Advance width in font units; throws with the character and hex codepoint when unmapped. */
  advanceOf(codePoint: number): number;
}

type GlyphResolver = (codePoint: number) => number;

const TAG_TTC = 0x74746366;

export function parseFont(data: Uint8Array): FontMetrics {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const sfnt = dv.getUint32(0);
  if (sfnt === TAG_TTC) {
    throw new Error(
      "TrueType Collection (.ttc) files are not supported; extract a single font first.",
    );
  }

  const numTables = dv.getUint16(4);
  const tables = new Map<string, number>();
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(
      data[rec],
      data[rec + 1],
      data[rec + 2],
      data[rec + 3],
    );
    tables.set(tag, dv.getUint32(rec + 8));
  }
  const tableOffset = (tag: string): number => {
    const offset = tables.get(tag);
    if (offset === undefined) {
      throw new Error(`font is missing the required '${tag}' table`);
    }
    return offset;
  };

  const head = tableOffset("head");
  const unitsPerEm = dv.getUint16(head + 18);

  const hhea = tableOffset("hhea");
  const ascender = dv.getInt16(hhea + 4);
  const descender = dv.getInt16(hhea + 6);
  const lineGap = dv.getInt16(hhea + 8);
  const numberOfHMetrics = dv.getUint16(hhea + 34);

  const hmtx = tableOffset("hmtx");
  const resolveGlyph = parseCmap(dv, data, tableOffset("cmap"));

  const advanceOf = (codePoint: number): number => {
    const glyph = resolveGlyph(codePoint);
    if (glyph === 0) {
      const hex = codePoint.toString(16).toUpperCase().padStart(4, "0");
      throw new Error(
        `no glyph for '${String.fromCodePoint(codePoint)}' (U+${hex}) in this font`,
      );
    }
    // hmtx stores only numberOfHMetrics advances; trailing glyphs (monospaced
    // runs) reuse the last one.
    const index = glyph < numberOfHMetrics ? glyph : numberOfHMetrics - 1;
    return dv.getUint16(hmtx + index * 4);
  };

  return {
    unitsPerEm,
    ascent: ascender,
    descent: Math.abs(descender),
    lineGap,
    advanceOf,
  };
}

/** Advance width of `word` in px, iterating code points so astral characters count once. */
export function wordAdvance(
  font: FontMetrics,
  word: string,
  size: number,
): number {
  const scale = size / font.unitsPerEm;
  let units = 0;
  for (const ch of word) units += font.advanceOf(ch.codePointAt(0)!);
  return units * scale;
}

/** Advance width of a single space (U+0020) in px. */
export function spaceAdvance(font: FontMetrics, size: number): number {
  return (font.advanceOf(0x20) * size) / font.unitsPerEm;
}

/**
 * A `measureContent` callback backed by parsed font metrics. Splits on
 * whitespace (same convention as `measureFromWordWidths`), resolves each word
 * to an unshaped advance, and delegates to `measureFromAdvances` so the
 * LayoutUnit quantization contract stays in outlay/text.
 */
export function measureText(
  font: FontMetrics,
  text: string,
  opts: { size: number; lineHeight: number },
): MeasureContent {
  const advances = text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => wordAdvance(font, word, opts.size));
  return measureFromAdvances(advances, {
    spaceWidth: spaceAdvance(font, opts.size),
    lineHeight: opts.lineHeight,
  });
}

function parseCmap(
  dv: DataView,
  data: Uint8Array,
  cmapOffset: number,
): GlyphResolver {
  const numSubtables = dv.getUint16(cmapOffset + 2);
  let best: { format: number; offset: number; score: number } | null = null;
  let sawFormat0 = false;

  for (let i = 0; i < numSubtables; i++) {
    const rec = cmapOffset + 4 + i * 8;
    const platformID = dv.getUint16(rec);
    const encodingID = dv.getUint16(rec + 2);
    const subOffset = cmapOffset + dv.getUint32(rec + 4);
    const format = dv.getUint16(subOffset);

    if (format === 0) sawFormat0 = true;

    const isUnicode =
      platformID === 0 ||
      (platformID === 3 && (encodingID === 1 || encodingID === 10));
    if (!isUnicode) continue;

    let score: number;
    if (format === 12) score = 3;
    else if (format === 4) score = platformID === 3 && encodingID === 1 ? 2 : 1;
    else continue;

    if (!best || score > best.score) best = { format, offset: subOffset, score };
  }

  if (!best) {
    if (sawFormat0) {
      throw new Error(
        "font's only cmap subtable is format 0; a Unicode format-4 or format-12 subtable is required.",
      );
    }
    throw new Error(
      "font has no supported Unicode cmap subtable (format 4 or 12).",
    );
  }

  return best.format === 12
    ? parseCmapFormat12(dv, best.offset)
    : parseCmapFormat4(dv, best.offset);
}

function parseCmapFormat4(dv: DataView, off: number): GlyphResolver {
  const segCountX2 = dv.getUint16(off + 6);
  const segCount = segCountX2 / 2;
  const endCodes = off + 14;
  const startCodes = endCodes + segCountX2 + 2;
  const idDeltas = startCodes + segCountX2;
  const idRangeOffsets = idDeltas + segCountX2;

  return (cp) => {
    if (cp > 0xffff) return 0;
    let lo = 0;
    let hi = segCount - 1;
    let seg = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (dv.getUint16(endCodes + mid * 2) >= cp) {
        seg = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    if (seg < 0) return 0;

    const start = dv.getUint16(startCodes + seg * 2);
    if (start > cp) return 0;

    const idDelta = dv.getInt16(idDeltas + seg * 2);
    const idRangeOffset = dv.getUint16(idRangeOffsets + seg * 2);
    if (idRangeOffset === 0) return (cp + idDelta) & 0xffff;

    const glyphAddr =
      idRangeOffsets + seg * 2 + idRangeOffset + (cp - start) * 2;
    const glyph = dv.getUint16(glyphAddr);
    return glyph === 0 ? 0 : (glyph + idDelta) & 0xffff;
  };
}

function parseCmapFormat12(dv: DataView, off: number): GlyphResolver {
  const numGroups = dv.getUint32(off + 12);
  const groups = off + 16;

  return (cp) => {
    let lo = 0;
    let hi = numGroups - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const group = groups + mid * 12;
      const startChar = dv.getUint32(group);
      const endChar = dv.getUint32(group + 4);
      if (cp < startChar) hi = mid - 1;
      else if (cp > endChar) lo = mid + 1;
      else return dv.getUint32(group + 8) + (cp - startChar);
    }
    return 0;
  };
}
