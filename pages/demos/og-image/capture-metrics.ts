/**
 * One-time word-advance capture for the OG-image card.
 *
 * Measures every word the card renders in headless Chromium (per font role)
 * and commits the advances to word-metrics.json, so generate.ts runs with no
 * browser at all. Re-run only when content.ts changes.
 *
 *   npx tsx pages/demos/og-image/capture-metrics.ts
 */

import * as fs from "fs";
import * as path from "path";
import puppeteer from "puppeteer";
import { FONTS, textsByRole, wordsOf, type FontRole } from "./content";

interface CaptureSpec {
  role: FontRole;
  family: string;
  size: number;
  weight: number;
  words: string[];
}

async function main() {
  const byRole = textsByRole();
  const specs: CaptureSpec[] = (Object.keys(FONTS) as FontRole[]).map((role) => {
    const unique = new Set<string>();
    for (const text of byRole[role]) for (const w of wordsOf(text)) unique.add(w);
    return { role, ...FONTS[role], words: [...unique] };
  });

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent("<!doctype html><body></body>");

  // A raw string, not a closure: tsx's esbuild transform injects a __name
  // helper into serialized closures that doesn't exist in the page context.
  const measureInPage = `(specs) => specs.map((spec) => {
    const probe = document.createElement("span");
    probe.style.position = "absolute";
    probe.style.whiteSpace = "pre";
    probe.style.fontFamily = spec.family;
    probe.style.fontSize = spec.size + "px";
    probe.style.fontWeight = String(spec.weight);
    document.body.appendChild(probe);
    const widthOf = (text) => {
      probe.textContent = text;
      return probe.getBoundingClientRect().width;
    };
    const words = {};
    for (const w of spec.words) words[w] = widthOf(w);
    const spaceWidth = widthOf("x x") - 2 * widthOf("x");
    probe.remove();
    return { role: spec.role, spaceWidth, words };
  })`;
  const measured = (await page.evaluate(
    `(${measureInPage})(${JSON.stringify(specs)})`,
  )) as { role: FontRole; spaceWidth: number; words: Record<string, number> }[];

  await browser.close();

  const table: Record<string, { spaceWidth: number; words: Record<string, number> }> = {};
  for (const m of measured) table[m.role] = { spaceWidth: m.spaceWidth, words: m.words };

  const outPath = path.join(import.meta.dirname, "word-metrics.json");
  fs.writeFileSync(outPath, JSON.stringify(table, null, 2) + "\n");
  console.error(
    `Captured ${measured.reduce((n, m) => n + Object.keys(m.words).length, 0)} advances → ${path.relative(process.cwd(), outPath)}`,
  );
}

main();
