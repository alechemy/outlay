export const BOX_COLORS = [
  "#e8d5c4", "#c4d4e0", "#d4e0c4", "#e0d4c4", "#c4d8d4",
  "#dcc4e0", "#e0c4c4", "#c4c8e0", "#d8e0c4", "#e0dcc4",
  "#c4e0d8", "#e0c4d8", "#d0c4e0", "#c4e0c8", "#e0ccc4",
  "#c4dce0",
];

export function colorAt(i: number): string {
  return BOX_COLORS[((i % BOX_COLORS.length) + BOX_COLORS.length) % BOX_COLORS.length];
}
