/**
 * verify-text-demo.ts
 *
 * Drives the Text-driven layout demo in headless Chromium and asserts that the
 * solver pane matches the browser reference pane across container widths. The
 * demo measures text with the Pretext adapter and computes the comparison
 * itself (the "#match-status" badge); this script sweeps the width slider and
 * fails if any width reports a mismatch.
 *
 * Usage:
 *
 *   npm run verify:text-demo
 *
 * Starts its own vite server on port 5198; no dev server needs to be running.
 */

import { spawn } from "child_process";
import * as path from "path";
import puppeteer, { Page } from "puppeteer";

const PORT = 5198;
const URL = `http://localhost:${PORT}/demos/text-layout.html`;

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(URL);
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`vite server did not come up on port ${PORT}`);
}

async function setWidth(page: Page, width: number): Promise<void> {
  await page.evaluate((w: number) => {
    const el = document.getElementById("width") as HTMLInputElement;
    el.value = String(w);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, width);
  await new Promise((r) => setTimeout(r, 120));
}

async function readBadge(page: Page): Promise<{ ok: boolean; badge: string }> {
  return page.evaluate(() => {
    const el = document.getElementById("match-status")!;
    return { ok: el.className.includes("ok"), badge: el.textContent ?? "" };
  });
}

async function main() {
  const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
    cwd: path.join(import.meta.dirname, ".."),
    stdio: "ignore",
  });

  const results: { width: number; ok: boolean; badge: string }[] = [];
  let browser;
  try {
    await waitForServer();
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1000 });
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    await page.goto(URL, { waitUntil: "networkidle0" });

    const widths = [300, 320, 360, 400, 440, 500, 560, 620, 680, 720, 760];
    for (const width of widths) {
      await setWidth(page, width);
      const { ok, badge } = await readBadge(page);
      results.push({ width, ok, badge });
      console.log(`  ${ok ? "✓" : "✗"} width ${String(width).padEnd(4)} ${badge}`);
    }
    if (pageErrors.length > 0) {
      console.log("Page errors:");
      for (const e of pageErrors) console.log(`  ${e}`);
    }
  } finally {
    await browser?.close();
    server.kill();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} widths matched the browser.`,
  );
  if (failed.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
