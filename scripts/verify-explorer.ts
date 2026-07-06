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

// The width/height rows have a mode select (auto/px/%/keywords) and a slider.
async function setSizeMode(
  page: Page,
  prop: string,
  mode: string,
  value?: number,
): Promise<void> {
  await page.evaluate(
    (p: string, m: string, v: number | null) => {
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
      if (v !== null) setter.call(slider, String(v));
      select.value = m;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      if (v !== null) slider.dispatchEvent(new Event("input", { bubbles: true }));
    },
    prop,
    mode,
    value ?? null,
  );
}

async function setSizeFixed(page: Page, prop: string, value: number): Promise<void> {
  await setSizeMode(page, prop, "px", value);
}

async function setText(page: Page, prop: string, value: string): Promise<void> {
  await page.evaluate(
    (p: string, v: string) => {
      const row = [...document.querySelectorAll<HTMLElement>("#props .prop-row")].find(
        (r) => r.querySelector("label")?.textContent === p,
      );
      const input = row?.querySelector<HTMLInputElement>('input[type="text"]');
      if (!input) throw new Error(`text input for ${p} not found`);
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
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

    const reloadClean = async () => {
      await page.goto(URL, { waitUntil: "networkidle0" });
      await page.evaluate(NAME_SHIM);
    };

    console.log("Scenario: grid fixed tracks with explicit placement");
    await reloadClean();
    await setSelect(page, "display", "grid");
    await setSizeFixed(page, "width", 420);
    await setSizeFixed(page, "height", 280);
    await setText(page, "gridTemplateColumns", "120px 120px 120px");
    await setText(page, "gridTemplateRows", "80px 80px");
    await check("grid 3x2 fixed tracks, auto placement");
    await selectTreeNode(page, "node-2");
    await setText(page, "gridColumn", "3 / 4");
    await setText(page, "gridRow", "1 / 2");
    await check("explicit placement (col 3, row 1)");
    await selectTreeNode(page, "node-3");
    await setText(page, "gridColumn", "1 / 2");
    await setText(page, "gridRow", "2 / 3");
    await check("explicit placement (col 1, row 2)");

    console.log("Scenario: grid fr + auto tracks");
    await selectTreeNode(page, "node-1");
    await setText(page, "gridTemplateColumns", "100px 1fr auto");
    await setText(page, "gridTemplateRows", "60px auto");
    await selectTreeNode(page, "node-4");
    await setText(page, "gridColumn", "3 / 4");
    await setText(page, "gridRow", "2 / 3");
    await setSizeFixed(page, "width", 90);
    await setSizeFixed(page, "height", 70);
    await check("fr + auto tracks (auto sizes to content)");

    console.log("Scenario: grid column span");
    await selectTreeNode(page, "node-2");
    await setText(page, "gridColumn", "1 / span 2");
    await setText(page, "gridRow", "1 / 2");
    await check("column span 2");

    console.log("Scenario: grid justify/align variations");
    await reloadClean();
    await setSelect(page, "display", "grid");
    await setSizeFixed(page, "width", 500);
    await setSizeFixed(page, "height", 320);
    await setText(page, "gridTemplateColumns", "80px 80px");
    await setText(page, "gridTemplateRows", "60px 60px");
    await setSlider(page, "gap", 10);
    for (const id of ["node-2", "node-3", "node-4"]) {
      await selectTreeNode(page, id);
      await setSizeFixed(page, "width", 40);
      await setSizeFixed(page, "height", 30);
    }
    await selectTreeNode(page, "node-1");
    const gridAlign: [string, string][] = [
      ["justifyContent", "center"],
      ["justifyContent", "space-between"],
      ["justifyContent", "flex-end"],
      ["justifyItems", "center"],
      ["justifyItems", "end"],
      ["alignContent", "center"],
      ["alignContent", "space-between"],
      ["alignItems", "flex-end"],
    ];
    for (const [prop, val] of gridAlign) {
      await setSelect(page, prop, val);
      await check(`${prop}: ${val}`);
    }
    await selectTreeNode(page, "node-2");
    await setSelect(page, "justifySelf", "end");
    await check("item justifySelf: end");
    await setSelect(page, "alignSelf", "center");
    await check("item alignSelf: center");

    console.log("Scenario: grid auto-placement with implicit rows");
    await reloadClean();
    await setSelect(page, "display", "grid");
    await setSizeFixed(page, "height", 400);
    await setText(page, "gridTemplateColumns", "90px 90px");
    await setText(page, "gridTemplateRows", "50px");
    for (const id of ["node-2", "node-3", "node-4"]) {
      await selectTreeNode(page, id);
      await setSizeFixed(page, "height", 45);
    }
    await selectTreeNode(page, "node-1");
    await addChildToSelected(page);
    await addChildToSelected(page);
    await check("auto-placement, 5 items, implicit rows");
    await setSelect(page, "gridAutoFlow", "row dense");
    await check("gridAutoFlow: row dense");

    console.log("Scenario: grid repeat(auto-fill, minmax)");
    await reloadClean();
    await setSelect(page, "display", "grid");
    await setSizeFixed(page, "width", 520);
    await setText(page, "gridTemplateColumns", "repeat(auto-fill, minmax(100px, 1fr))");
    await setText(page, "gridTemplateRows", "80px");
    await check("repeat(auto-fill, minmax(100px, 1fr))");

    console.log("Scenario: flex alignContent space-evenly");
    await reloadClean();
    await setSizeFixed(page, "width", 420);
    await setSizeFixed(page, "height", 300);
    await setSelect(page, "flexWrap", "wrap");
    for (const id of ["node-2", "node-3", "node-4"]) {
      await selectTreeNode(page, id);
      await setSlider(page, "flexGrow", 0);
      await setSizeFixed(page, "width", 150);
      await setSizeFixed(page, "height", 60);
    }
    await selectTreeNode(page, "node-1");
    await setSelect(page, "alignContent", "space-evenly");
    await check("flex wrap + alignContent: space-evenly");
    await setSelect(page, "alignContent", "space-between");
    await check("flex wrap + alignContent: space-between");

    console.log("Scenario: aspect ratio");
    await setSelect(page, "alignContent", "stretch");
    await selectTreeNode(page, "node-2");
    await setSizeMode(page, "width", "auto");
    await setSelect(page, "aspectRatio", "2");
    await check("aspectRatio 2 with definite height (width transfers)");
    await setSelect(page, "aspectRatio", "0.5");
    await check("aspectRatio 0.5 with definite height");

    console.log("Scenario: percentages");
    await selectTreeNode(page, "node-3");
    await setSizeMode(page, "width", "%", 50);
    await check("width: 50% of the container");
    await selectTreeNode(page, "node-4");
    await setText(page, "flexBasis", "30%");
    await check("flexBasis: 30%");

    console.log("Scenario: keyword min/max and fit-content");
    await selectTreeNode(page, "node-2");
    await setSelect(page, "aspectRatio", "0");
    await addChildToSelected(page);
    await addChildToSelected(page);
    await setSlider(page, "flexGrow", 5);
    await setText(page, "maxWidth", "max-content");
    await check("flexGrow 5 capped by maxWidth: max-content");
    await setText(page, "maxWidth", "");
    await setSizeMode(page, "width", "fit-content");
    await setSlider(page, "flexGrow", 0);
    await check("width: fit-content on a nested container");

    console.log("Scenario: grid fit-content track + space-evenly");
    await reloadClean();
    await setSelect(page, "display", "grid");
    await setSizeFixed(page, "width", 480);
    await setSizeFixed(page, "height", 320);
    await setText(page, "gridTemplateColumns", "fit-content(160px) 1fr");
    await setText(page, "gridTemplateRows", "60px 60px");
    for (const id of ["node-2", "node-3", "node-4"]) {
      await selectTreeNode(page, id);
      await setSizeFixed(page, "width", 120);
      await setSizeFixed(page, "height", 40);
    }
    await selectTreeNode(page, "node-1");
    await check("fit-content(160px) column sized by contents");
    await setText(page, "gridTemplateColumns", "fit-content(60px) 1fr");
    await check("fit-content(60px) floored at min-content");
    await setSelect(page, "alignContent", "space-evenly");
    await check("grid alignContent: space-evenly");

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
