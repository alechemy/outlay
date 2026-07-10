export interface FontSpec {
  size: number;
  weight: number;
  lineHeight: number;
}

export const FONT_FAMILY = `Inter, "Helvetica Neue", Arial, sans-serif`;

export const FONTS = {
  title: { size: 92, weight: 700, lineHeight: 92 },
  badge: { size: 22, weight: 500, lineHeight: 28 },
  tagline: { size: 31, weight: 400, lineHeight: 46 },
  statValue: { size: 44, weight: 700, lineHeight: 48 },
  statLabel: { size: 17, weight: 400, lineHeight: 24 },
  tag: { size: 18, weight: 500, lineHeight: 24 },
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
