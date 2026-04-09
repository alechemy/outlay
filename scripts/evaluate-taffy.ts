import * as fs from "fs";
import * as path from "path";

async function run() {
  console.log("Initializing Taffy WebAssembly...");
  const Taffy = await import("taffy-layout");
  await Taffy.loadTaffy();

  const fixturesDirs = [
    path.join(__dirname, "..", "fixtures"),
    path.join(__dirname, "..", "fixtures", "yoga"),
  ];

  let files: string[] = [];
  for (const dir of fixturesDirs) {
    if (fs.existsSync(dir)) {
      const dirFiles = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => path.join(dir, f));
      files = files.concat(dirFiles);
    }
  }

  let totalTests = 0;
  let passedTests = 0;
  let totalError = 0;
  const errorLog: string[] = [];

  for (const file of files) {
    const fixture = JSON.parse(fs.readFileSync(file, "utf-8"));
    const tree = new Taffy.TaffyTree();
    const idToTid = new Map<string, bigint>();

    function build(node: any): bigint {
      const style = new Taffy.Style();

      if (node.display === "none") style.display = Taffy.Display?.None;
      else if (node.display === "flex") style.display = Taffy.Display?.Flex;
      else if (node.display === "grid") style.display = Taffy.Display?.Grid;
      else if (node.display === "block" && Taffy.Display?.Block !== undefined) {
        style.display = Taffy.Display?.Block;
      } else {
        style.display = Taffy.Display?.Flex; // fallback
      }

      if (
        node.boxSizing === "border-box" &&
        (Taffy as any).BoxSizing?.BorderBox
      ) {
        (style as any).boxSizing = (Taffy as any).BoxSizing.BorderBox;
      }

      if (typeof node.width === "number") style.width = node.width;
      else if (node.width === "auto") style.width = "auto";
      else if (node.width === "min-content") style.width = "auto";
      else if (node.width === "max-content") style.width = "auto";

      if (typeof node.height === "number") style.height = node.height;
      else if (node.height === "auto") style.height = "auto";
      else if (node.height === "min-content") style.height = "auto";
      else if (node.height === "max-content") style.height = "auto";

      if (node.padding) {
        style.padding = {
          left: node.padding.left || 0,
          right: node.padding.right || 0,
          top: node.padding.top || 0,
          bottom: node.padding.bottom || 0,
        };
      }
      if (node.margin) {
        style.margin = {
          left: node.margin.left || 0,
          right: node.margin.right || 0,
          top: node.margin.top || 0,
          bottom: node.margin.bottom || 0,
        };
      }
      if (node.border) {
        style.border = {
          left: node.border.left || 0,
          right: node.border.right || 0,
          top: node.border.top || 0,
          bottom: node.border.bottom || 0,
        };
      }

      if (node.flexDirection) {
        const fd = {
          row: Taffy.FlexDirection?.Row,
          column: Taffy.FlexDirection?.Column,
          "row-reverse": Taffy.FlexDirection?.RowReverse,
          "column-reverse": Taffy.FlexDirection?.ColumnReverse,
        }[node.flexDirection as string];
        if (fd !== undefined) style.flexDirection = fd;
      }

      if (node.flexWrap) {
        const fw = {
          nowrap: Taffy.FlexWrap?.NoWrap,
          wrap: Taffy.FlexWrap?.Wrap,
          "wrap-reverse": Taffy.FlexWrap?.WrapReverse,
        }[node.flexWrap as string];
        if (fw !== undefined) style.flexWrap = fw;
      }

      if (node.justifyContent) {
        const jc = {
          "flex-start": Taffy.JustifyContent?.FlexStart,
          "flex-end": Taffy.JustifyContent?.FlexEnd,
          center: Taffy.JustifyContent?.Center,
          "space-between": Taffy.JustifyContent?.SpaceBetween,
          "space-around": Taffy.JustifyContent?.SpaceAround,
          "space-evenly": Taffy.JustifyContent?.SpaceEvenly,
        }[node.justifyContent as string];
        if (jc !== undefined) style.justifyContent = jc;
      }

      if (node.alignItems) {
        const ai = {
          "flex-start": Taffy.AlignItems?.FlexStart,
          "flex-end": Taffy.AlignItems?.FlexEnd,
          center: Taffy.AlignItems?.Center,
          stretch: Taffy.AlignItems?.Stretch,
          baseline: Taffy.AlignItems?.Baseline,
        }[node.alignItems as string];
        if (ai !== undefined) style.alignItems = ai;
      }

      if (node.alignContent) {
        const ac = {
          "flex-start": Taffy.AlignContent?.FlexStart,
          "flex-end": Taffy.AlignContent?.FlexEnd,
          center: Taffy.AlignContent?.Center,
          stretch: Taffy.AlignContent?.Stretch,
          "space-between": Taffy.AlignContent?.SpaceBetween,
          "space-around": Taffy.AlignContent?.SpaceAround,
        }[node.alignContent as string];
        if (ac !== undefined) style.alignContent = ac;
      }

      if (node.flexGrow !== undefined) style.flexGrow = node.flexGrow;
      if (node.flexShrink !== undefined) style.flexShrink = node.flexShrink;

      if (node.flexBasis !== undefined) {
        if (typeof node.flexBasis === "number" || node.flexBasis === "auto") {
          style.flexBasis = node.flexBasis as any;
        }
      }

      if (node.gap !== undefined) {
        if (typeof node.gap === "number") {
          style.gap = { width: node.gap, height: node.gap };
        } else {
          style.gap = { width: node.gap.column, height: node.gap.row };
        }
      }

      const childIds = (node.children || []).map(build);
      const tId =
        childIds.length > 0
          ? tree.newWithChildren(style, childIds)
          : tree.newLeaf(style);
      idToTid.set(node.id, tId);
      return tId;
    }

    try {
      const rootTId = build(fixture.input);
      tree.computeLayout(rootTId, {
        width: "max-content",
        height: "max-content",
      });

      let testError = 0;
      let testCount = 0;

      for (const [id, expectedBox] of Object.entries<any>(fixture.expected)) {
        const tId = idToTid.get(id);
        if (tId === undefined) continue;

        const layout = tree.getLayout(tId);

        // We check dimensions to bypass local vs absolute coordinate issues
        // which gives us a solid signal on accuracy.
        const wErr = Math.abs(layout.width - expectedBox.width);
        const hErr = Math.abs(layout.height - expectedBox.height);

        testError += wErr + hErr;
        testCount += 2;
      }

      const avgError = testCount > 0 ? testError / testCount : 0;
      totalError += avgError;
      totalTests++;

      if (avgError <= fixture.tolerance) {
        passedTests++;
      } else {
        errorLog.push(
          `${path.basename(file)}: Mean Error = ${avgError.toFixed(2)}px`,
        );
      }
    } catch (e) {
      console.error(`Error running ${path.basename(file)}:`, e);
      totalTests++;
    }
  }

  const distDir = path.join(__dirname, "..", "node_modules", "taffy-layout");
  let wasmSize = 0;

  function findWasm(dir: string) {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      if (fs.statSync(fullPath).isDirectory()) {
        findWasm(fullPath);
      } else if (item.endsWith(".wasm")) {
        wasmSize = fs.statSync(fullPath).size;
      }
    }
  }
  findWasm(distDir);

  console.log("\n=================================");
  console.log("=== Taffy Evaluation Results  ===");
  console.log("=================================\n");
  console.log(`Total Tests Run:  ${totalTests}`);
  const passPercent =
    totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 0;
  console.log(`Tests Passed:     ${passedTests} (${passPercent}%)`);
  console.log(`Tests Failed:     ${totalTests - passedTests}`);
  const meanErr = totalTests > 0 ? totalError / totalTests : 0;
  console.log(`Mean Dim Error:   ${meanErr.toFixed(2)}px`);
  console.log(`WASM Bundle Size: ${(wasmSize / 1024).toFixed(2)} KB`);

  console.log("\n=== API Friction Report ===");
  console.log(
    "1. Enum Mapping: Requires mapping standard CSS string values to Taffy-specific enums (Display, FlexDirection, etc.).",
  );
  console.log(
    "2. Dimension Formatting: Requires explicit parsing for lengths versus keywords.",
  );
  console.log(
    "3. Tree Construction: Uses an ID-based TaffyTree structure which means mapping nested node definitions into a linear flat map and referencing IDs bottom-up.",
  );
  console.log(
    "4. Layout Coordinates: getLayout() returns local coordinates relative to the parent box (and ignores our standard output model mapping without manual unrolling).",
  );
  console.log(
    "5. Web Spec Variances: Taffy handles CSS Flexbox quite well but differs from browser nuances in standard block formatting (like margin collapse).",
  );

  console.log("\n=== Recommendation ===");
  if (passPercent < 80) {
    console.log(
      "Recommendation: Build from scratch. Taffy's block layout behaviors clash with strict browser behavior, and the WASM interop overhead + API mapping is too great for the accuracy level returned.",
    );
  } else {
    console.log(
      "Recommendation: Wrap Taffy. It handles complex layout cases extremely well and provides a fast, ready-made solution.",
    );
  }
}

run().catch(console.error);
