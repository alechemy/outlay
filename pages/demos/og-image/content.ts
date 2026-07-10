export interface FontSpec {
  family: string;
  size: number;
  weight: number;
  lineHeight: number;
}

const SANS = `"Helvetica Neue", Arial, sans-serif`;

export const FONTS = {
  title: { family: SANS, size: 92, weight: 700, lineHeight: 92 },
  badge: { family: SANS, size: 22, weight: 500, lineHeight: 28 },
  tagline: { family: SANS, size: 31, weight: 400, lineHeight: 46 },
  statValue: { family: SANS, size: 44, weight: 700, lineHeight: 48 },
  statLabel: { family: SANS, size: 17, weight: 400, lineHeight: 24 },
  tag: { family: SANS, size: 18, weight: 500, lineHeight: 24 },
} satisfies Record<string, FontSpec>;

export type FontRole = keyof typeof FONTS;

export const CARD = {
  title: "outlay",
  badge: "v1.3.0 · npm",
  tagline:
    "Flexbox and CSS Grid, solved in pure JavaScript — no browser, no WASM, no async. Every box verified against Chromium to half a pixel.",
  stats: [
    { value: "4,450", label: "Chromium-verified fixtures" },
    { value: "0.5px", label: "maximum divergence" },
    { value: "14ms", label: "to solve 10,000 nodes" },
    { value: "0", label: "core dependencies" },
  ],
  tags: [
    "display: grid",
    "flex-wrap",
    "minmax()",
    "auto-fill",
    "aspect-ratio",
    "fit-content",
  ],
  repo: "github.com/alechemy/outlay",
};

export function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Every string the card renders, grouped by font role, for metrics capture. */
export function textsByRole(): Record<FontRole, string[]> {
  return {
    title: [CARD.title],
    badge: [CARD.badge],
    tagline: [CARD.tagline],
    statValue: CARD.stats.map((s) => s.value),
    statLabel: CARD.stats.map((s) => s.label),
    tag: [...CARD.tags, CARD.repo],
  };
}
