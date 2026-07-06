/**
 * verify-html-playground.ts
 *
 * Drives the HTML Playground demo in headless Chromium. For every valid preset
 * (and the seed the page loads with) it asserts the "#match-status" badge reports
 * a match against the live browser; for the invalid preset it asserts the demo
 * surfaces the HTMLParseError path and message. Fails the process on any
 * mismatch or unexpected page error.
 *
 * Usage:
 *
 *   npm run verify:html-demo
 *
 * Starts its own vite server on port 5201; no dev server needs to be running.
 */

import { spawn } from "child_process";
import * as path from "path";
import puppeteer, { Page } from "puppeteer";

const PORT = 5201;
const URL = `http://localhost:${PORT}/demos/html-playground.html`;

// tsx's esbuild keepNames transform injects __name() into serialized evaluate
// callbacks; the helper doesn't exist in the page context.
const NAME_SHIM = "globalThis.__name = globalThis.__name || ((f) => f);";

interface StepResult {
  step: string;
  ok: boolean;
  detail: string;
}

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

async function clickPreset(page: Page, preset: string): Promise<void> {
  await page.evaluate((p: string) => {
    const btn = document.querySelector<HTMLButtonElement>(
      `.btn[data-preset="${p}"]`,
    );
    if (!btn) throw new Error(`preset button "${p}" not found`);
    btn.click();
  }, preset);
  await new Promise((r) => setTimeout(r, 120));
}

async function readState(page: Page) {
  return page.evaluate(() => {
    const badge = document.getElementById("match-status")!;
    const panel = document.getElementById("error-panel")!;
    return {
      badgeText: badge.textContent ?? "",
      ok: badge.className.includes("ok"),
      warn: badge.className.includes("warn"),
      errorShown: panel.classList.contains("show"),
      path: document.getElementById("error-path")!.textContent ?? "",
      message: document.getElementById("error-message")!.textContent ?? "",
    };
  });
}

async function main() {
  const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
    cwd: path.join(import.meta.dirname, ".."),
    stdio: "ignore",
  });

  const results: StepResult[] = [];
  const pageErrors: string[] = [];
  let browser;
  try {
    await waitForServer();
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1100 });
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") pageErrors.push(m.text());
    });
    await page.goto(URL, { waitUntil: "networkidle0" });
    await page.evaluate(NAME_SHIM);
    await page.waitForFunction(
      () => (document.getElementById("match-status")?.textContent ?? "").length > 0,
    );

    const record = (step: string, ok: boolean, detail: string) => {
      results.push({ step, ok, detail });
      console.log(`  ${ok ? "✓" : "✗"} ${step.padEnd(40)} ${detail}`);
    };

    // Seed renders on load.
    {
      const s = await readState(page);
      record("seed (initial render)", s.ok, s.badgeText);
    }

    // Valid presets must all match the browser.
    for (const preset of ["flex", "grid", "seed"]) {
      await clickPreset(page, preset);
      const s = await readState(page);
      record(`preset "${preset}"`, s.ok, s.badgeText);
    }

    // Invalid preset must surface the parse error, its path, and its message.
    {
      await clickPreset(page, "invalid");
      const s = await readState(page);
      const ok =
        s.warn &&
        s.errorShown &&
        s.path.includes("nth-child(2)") &&
        /\bem\b/i.test(s.message);
      record(
        'preset "invalid" (parse error)',
        ok,
        `path=${JSON.stringify(s.path)} badge=${JSON.stringify(s.badgeText)}`,
      );
    }

    // Recovery: a valid preset after the error clears the error state.
    {
      await clickPreset(page, "seed");
      const s = await readState(page);
      record("recovers after error", s.ok && !s.errorShown, s.badgeText);
    }

    if (pageErrors.length > 0) {
      console.log("\nPage errors:");
      for (const e of pageErrors) console.log(`  ${e}`);
    }
  } finally {
    await browser?.close();
    server.kill();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} steps passed.`,
  );
  if (failed.length > 0 || pageErrors.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
