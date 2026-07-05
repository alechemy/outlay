/**
 * verify-explorer.ts
 *
 * Drives the Layout Explorer demo in headless Chromium and asserts that the
 * solver pane matches the browser CSS reference pane after every control
 * change. The demo computes the comparison itself (the "#match-status" badge);
 * this script exercises the controls the way a user would and fails if any
 * step reports a mismatch.
 *
 * Usage:
 *
 *   npm run verify:explorer
 *
 * Starts its own vite server on port 5199; no dev server needs to be running.
 * Screenshots are written to .explorer-verify/ (gitignored).
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import puppeteer, { Page } from "puppeteer";

const PORT = 5199;
const URL = `http://localhost:${PORT}/demos/explorer.html`;
const SHOT_DIR = path.join(import.meta.dirname, "..", ".explorer-verify");

// tsx's esbuild keepNames transform injects __name() calls into serialized
// evaluate callbacks; the helper doesn't exist in the page context.
const NAME_SHIM = "globalThis.__name = globalThis.__name || ((f) => f);";

interface StepResult {
  step: string;
  ok: boolean;
  badge: string;
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

async function readBadge(page: Page): Promise<{ ok: boolean; badge: string }> {
  return page.evaluate(() => {
    const el = document.getElementById("match-status")!;
    return { ok: el.className.includes("ok"), badge: el.textContent ?? "" };
  });
}

async function selectTreeNode(page: Page, id: string): Promise<void> {
  await page.evaluate((nodeId: string) => {
    const rows = [...document.querySelectorAll<HTMLElement>(".tree-node-label")];
    const row = rows.find((r) => r.textContent!.startsWith(nodeId + " "));
    if (!row) throw new Error(`tree row for ${nodeId} not found`);
    row.click();
  }, id);
}

async function setSelect(page: Page, prop: string, value: string): Promise<void> {
  await page.evaluate(
    (p: string, v: string) => {
      const row = [...document.querySelectorAll<HTMLElement>("#props .prop-row")].find(
        (r) => r.querySelector("label")?.textContent === p,
      );
      const select = row?.querySelector("select");
      if (!select) throw new Error(`select for ${p} not found`);
      select.value = v;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    },
    prop,
    value,
  );
}

async function setSlider(page: Page, prop: string, value: number): Promise<void> {
  await page.evaluate(
    (p: string, v: number) => {
      const row = [...document.querySelectorAll<HTMLElement>("#props .prop-row")].find(
        (r) => r.querySelector("label")?.textContent === p,
      );
      const slider = row?.querySelector<HTMLInputElement>('input[type="range"]');
      if (!slider) throw new Error(`slider for ${p} not found`);
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(slider, String(v));
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    },
    prop,
    value,
  );
}

// The width/height rows have both a mode select (auto/fixed) and a slider.
async function setSizeFixed(page: Page, prop: string, value: number): Promise<void> {
  await page.evaluate(
    (p: string, v: number) => {
      const row = [...document.querySelectorAll<HTMLElement>("#props .prop-row")].find(
        (r) => r.querySelector("label")?.textContent === p,
      );
      if (!row) throw new Error(`size row for ${p} not found`);
      const select = row.querySelector("select")!;
      const slider = row.querySelector<HTMLInputElement>('input[type="range"]')!;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(slider, String(v));
      select.value = "fixed";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    },
    prop,
    value,
  );
}

async function addChildToSelected(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.getElementById("btn-add-root-child")!.click();
  });
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
    cwd: path.join(import.meta.dirname, ".."),
    stdio: "ignore",
  });

  const results: StepResult[] = [];
  let browser;
  try {
    await waitForServer();
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto(URL, { waitUntil: "networkidle0" });
    await page.evaluate(NAME_SHIM);

    const check = async (step: string) => {
      const { ok, badge } = await readBadge(page);
      results.push({ step, ok, badge });
      const mark = ok ? "✓" : "✗";
      console.log(`  ${mark} ${step.padEnd(52)} ${badge}`);
      if (!ok) {
        await page.screenshot({
          path: path.join(SHOT_DIR, `fail-${results.length}.png`) as `${string}.png`,
          fullPage: true,
        });
      }
    };

    console.log("Scenario: default tree");
    await check("initial render (gap 8, padding 12, grow 1/2/1)");

    console.log("Scenario: justify-content with growing children");
    for (const jc of [
      "flex-end",
      "center",
      "space-between",
      "space-around",
      "space-evenly",
    ]) {
      await setSelect(page, "justifyContent", jc);
      await check(`justifyContent: ${jc} (grow eats free space)`);
    }

    console.log("Scenario: justify-content with inflexible children");
    for (const id of ["node-2", "node-3", "node-4"]) {
      await selectTreeNode(page, id);
      await setSlider(page, "flexGrow", 0);
    }
    await selectTreeNode(page, "node-1");
    for (const jc of [
      "flex-start",
      "flex-end",
      "center",
      "space-between",
      "space-around",
      "space-evenly",
    ]) {
      await setSelect(page, "justifyContent", jc);
      await check(`justifyContent: ${jc} (grow 0)`);
    }

    console.log("Scenario: align-items with a fixed-height child");
    await selectTreeNode(page, "node-2");
    await setSizeFixed(page, "height", 120);
    await selectTreeNode(page, "node-1");
    for (const ai of ["flex-start", "flex-end", "center", "stretch", "baseline"]) {
      await setSelect(page, "alignItems", ai);
      await check(`alignItems: ${ai}`);
    }
    await setSelect(page, "alignItems", "stretch");

    console.log("Scenario: padding and gap sweeps on root");
    for (const pad of [0, 5, 18, 40]) {
      await setSlider(page, "padding", pad);
      await check(`padding: ${pad}`);
    }
    for (const gap of [0, 13, 32]) {
      await setSlider(page, "gap", gap);
      await check(`gap: ${gap}`);
    }

    console.log("Scenario: wrapping");
    for (let i = 0; i < 4; i++) await addChildToSelected(page);
    await setSelect(page, "flexWrap", "wrap");
    await check("flexWrap: wrap with 7 children");
    await setSelect(page, "flexWrap", "wrap-reverse");
    await check("flexWrap: wrap-reverse");
    await setSelect(page, "justifyContent", "space-between");
    await check("wrap-reverse + space-between");

    console.log("Scenario: directions");
    for (const dir of ["column", "row-reverse", "column-reverse", "row"]) {
      await setSelect(page, "flexDirection", dir);
      await check(`flexDirection: ${dir}`);
    }

    console.log("Scenario: nested container");
    await selectTreeNode(page, "node-2");
    await addChildToSelected(page);
    await addChildToSelected(page);
    await setSlider(page, "gap", 6);
    await setSelect(page, "flexDirection", "column");
    await check("nested column container with gap 6");

    await page.screenshot({
      path: path.join(SHOT_DIR, "final.png") as `${string}.png`,
      fullPage: true,
    });
  } finally {
    await browser?.close();
    server.kill();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} steps matched the browser.`,
  );
  if (failed.length > 0) {
    console.log(`Screenshots of failures are in ${SHOT_DIR}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
