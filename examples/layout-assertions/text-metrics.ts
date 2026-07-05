import metrics from "./word-metrics.json" with { type: "json" };

export interface WordMetrics {
  spaceWidth: number;
  lineHeight: number;
  words: Record<string, number>;
}

const table = metrics as WordMetrics;

export function wordAdvance(word: string): number {
  const advance = table.words[word];
  if (advance === undefined) {
    throw new Error(`No committed advance for "${word}"; add it to word-metrics.json`);
  }
  return advance;
}

export function widestWord(text: string): number {
  return words(text).reduce((max, w) => Math.max(max, wordAdvance(w)), 0);
}

/**
 * A Node-safe `measureContent`: greedy line breaking over precomputed per-word
 * advances. Same algorithm the fixture runner applies to Chromium-captured word
 * widths, so it mirrors what a Pretext-backed measurer returns in a browser.
 */
export function measureText(
  text: string,
): (availableWidth: number) => { width: number; height: number } {
  const advances = words(text).map(wordAdvance);
  const { spaceWidth, lineHeight } = table;
  return (availableWidth) => {
    if (advances.length === 0) return { width: 0, height: 0 };
    let lines = 1;
    let cur = advances[0];
    let maxLine = cur;
    for (let i = 1; i < advances.length; i++) {
      const w = advances[i];
      if (cur + spaceWidth + w <= availableWidth) {
        cur += spaceWidth + w;
      } else {
        lines++;
        cur = w;
      }
      if (cur > maxLine) maxLine = cur;
    }
    return { width: maxLine, height: lines * lineHeight };
  };
}

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}
