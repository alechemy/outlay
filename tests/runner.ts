import * as fs from "fs";
import * as path from "path";
import { solveLayout } from "../src/solver";

function runTests() {
  const fixturesDir = path.join(__dirname, "..", "fixtures");
  if (!fs.existsSync(fixturesDir)) {
    console.error(`Fixtures directory not found: ${fixturesDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.error("No fixtures found. Run generator first.");
    process.exit(1);
  }

  let passedFixtures = 0;
  let failedFixtures = 0;

  for (const file of files) {
    const fixturePath = path.join(fixturesDir, file);
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));

    const { input, expected, tolerance = 0.5, seed, tier } = fixture;
    const result = solveLayout(input);

    let fixtureFailed = false;
    const errors: string[] = [];

    // Compare actual boxes against expected boxes
    for (const [nodeId, expectedBox] of Object.entries(expected)) {
      const actualBox = result.boxes.get(nodeId);

      if (!actualBox) {
        fixtureFailed = true;
        errors.push(`  [${nodeId}] Missing in solver output.`);
        continue;
      }

      // Flat numeric properties
      const flatProps = [
        "x",
        "y",
        "width",
        "height",
        "borderBoxWidth",
        "borderBoxHeight",
        "outerWidth",
        "outerHeight",
      ] as const;

      for (const prop of flatProps) {
        const expectedVal = (expectedBox as any)[prop] as number;
        const actualVal = (actualBox as any)[prop] as number;

        // Treat undefined as 0 for safe math
        const safeExpected = expectedVal || 0;
        const safeActual = actualVal || 0;

        const diff = Math.abs(safeExpected - safeActual);

        if (diff > tolerance) {
          fixtureFailed = true;
          errors.push(
            `  [${nodeId}] ${prop}: expected ${safeExpected.toFixed(2)}, got ${safeActual.toFixed(2)} (err: ${diff.toFixed(2)})`,
          );
        }
      }

      // Nested box model properties
      const nestedProps = ["padding", "border", "margin"] as const;
      const sides = ["top", "right", "bottom", "left"] as const;

      for (const prop of nestedProps) {
        for (const side of sides) {
          const expectedVal = (expectedBox as any)[prop]?.[side] as number;
          const actualVal = (actualBox as any)[prop]?.[side] as number;

          const safeExpected = expectedVal || 0;
          const safeActual = actualVal || 0;

          const diff = Math.abs(safeExpected - safeActual);

          if (diff > tolerance) {
            fixtureFailed = true;
            errors.push(
              `  [${nodeId}] ${prop}.${side}: expected ${safeExpected.toFixed(2)}, got ${safeActual.toFixed(2)} (err: ${diff.toFixed(2)})`,
            );
          }
        }
      }
    }

    if (fixtureFailed) {
      failedFixtures++;
      console.log(`❌ Fixture Failed: ${file} (Tier ${tier}, Seed ${seed})`);
      console.log(errors.join("\n"));
      console.log("");
    } else {
      passedFixtures++;
    }
  }

  console.log("--- Test Summary ---");
  console.log(`Total:  ${files.length}`);
  console.log(`Passed: ${passedFixtures}`);
  console.log(`Failed: ${failedFixtures}`);

  if (failedFixtures > 0) {
    process.exit(1);
  }
}

runTests();
