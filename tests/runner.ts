import { execSync } from "child_process";
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

  const lockedTestsPath = path.join(__dirname, "locked_tests.json");
  const lockedTests: string[] = fs.existsSync(lockedTestsPath)
    ? JSON.parse(fs.readFileSync(lockedTestsPath, "utf-8"))
    : [];

  const newlyPassedTests: string[] = [];
  let hasRegression = false;

  let passedFixtures = 0;
  let failedFixtures = 0;

  let totalErrorAcrossFailing = 0;

  const tierStats: Record<number, { passed: number; failed: number }> = {};

  type FailingTestInfo = {
    file: string;
    tier: number;
    nodeCount: number;
    meanError: number;
  };
  const failingTestInfos: FailingTestInfo[] = [];

  for (const file of files) {
    const fixturePath = path.join(fixturesDir, file);
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));

    const { input, expected, tolerance = 0.5, seed, tier } = fixture;
    const nodeCount = Object.keys(expected).length;

    if (!tierStats[tier]) {
      tierStats[tier] = { passed: 0, failed: 0 };
    }

    let result;
    try {
      result = solveLayout(input);
    } catch (e) {
      console.log(`❌ Fixture Errored: ${file}`);
      console.error(e);
      failedFixtures++;
      tierStats[tier].failed++;
      if (lockedTests.includes(file)) {
        hasRegression = true;
        console.error(
          `🚨 REGRESSION DETECTED: ${file} was locked as passing but now throws an error!`,
        );
      }
      totalErrorAcrossFailing += 1000; // Arbitrary high error for throwing
      failingTestInfos.push({ file, tier, nodeCount, meanError: 1000 });
      continue;
    }

    let fixtureFailed = false;
    const errors: string[] = [];

    let testTotalError = 0;
    let testErrorCount = 0;

    // Compare actual boxes against expected boxes
    for (const [nodeId, expectedBox] of Object.entries(expected)) {
      const actualBox = result.boxes.get(nodeId);

      if (!actualBox) {
        fixtureFailed = true;
        errors.push(`  [${nodeId}] Missing in solver output.`);
        testTotalError += 1000; // Arbitrary large penalty for missing box
        testErrorCount++;
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
        const expectedVal = (expectedBox as any)[prop] as number | undefined;
        if (expectedVal === undefined) continue;

        const actualVal = (actualBox as any)[prop] as number;

        const safeExpected = expectedVal || 0;
        const safeActual = actualVal || 0;

        const diff = Math.abs(safeExpected - safeActual);
        testTotalError += diff;
        testErrorCount++;

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
          const expectedVal = (expectedBox as any)[prop]?.[side] as
            | number
            | undefined;
          if (expectedVal === undefined) continue;

          const actualVal = (actualBox as any)[prop]?.[side] as number;

          const safeExpected = expectedVal || 0;
          const safeActual = actualVal || 0;

          const diff = Math.abs(safeExpected - safeActual);
          testTotalError += diff;
          testErrorCount++;

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
      tierStats[tier].failed++;

      const testMeanError =
        testErrorCount > 0 ? testTotalError / testErrorCount : 0;
      totalErrorAcrossFailing += testMeanError;

      console.log(`❌ Fixture Failed: ${file} (Tier ${tier}, Seed ${seed})`);
      console.log(`   Mean Error for test: ${testMeanError.toFixed(4)}px`);
      console.log(errors.join("\n"));
      console.log("");

      failingTestInfos.push({
        file,
        tier,
        nodeCount,
        meanError: testMeanError,
      });

      if (lockedTests.includes(file)) {
        hasRegression = true;
        console.error(
          `🚨 REGRESSION DETECTED: ${file} was locked as passing but now fails!`,
        );
      }
    } else {
      passedFixtures++;
      tierStats[tier].passed++;
      if (!lockedTests.includes(file)) {
        newlyPassedTests.push(file);
      }
    }
  }

  const totalTests = files.length;
  const passRate = totalTests > 0 ? passedFixtures / totalTests : 0;
  const meanFailingError =
    failedFixtures > 0 ? totalErrorAcrossFailing / failedFixtures : 0;

  const fitnessScore = passRate + 1 / (1 + meanFailingError);

  console.log("--- Test Summary ---");
  console.log(`Total:  ${totalTests}`);
  console.log(`Passed: ${passedFixtures}`);
  console.log(`Failed: ${failedFixtures}`);
  console.log(`\nFitness Score: ${fitnessScore.toFixed(6)}`);
  console.log(
    `Mean Error Across Failing Tests: ${meanFailingError.toFixed(4)}px`,
  );

  if (failingTestInfos.length > 0) {
    console.log("\n--- Highest Priority Failing Tests ---");
    failingTestInfos.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.nodeCount !== b.nodeCount) return a.nodeCount - b.nodeCount;
      return a.meanError - b.meanError;
    });

    for (const info of failingTestInfos.slice(0, 5)) {
      console.log(
        `- ${info.file} (Tier ${info.tier}, Nodes: ${info.nodeCount}, Mean Error: ${info.meanError.toFixed(4)}px)`,
      );
    }
  }

  if (!hasRegression && newlyPassedTests.length > 0) {
    const updatedLockedTests = [...lockedTests, ...newlyPassedTests].sort();
    fs.writeFileSync(
      lockedTestsPath,
      JSON.stringify(updatedLockedTests, null, 2),
      "utf-8",
    );
    console.log(`\n🔒 Locked ${newlyPassedTests.length} new passing tests.`);
  }

  const trackerPath = path.join(__dirname, "tracker.jsonl");
  const summaryMessage = process.argv.slice(2).join(" ") || "Iteration run";
  const entry = {
    timestamp: new Date().toISOString(),
    fitness: fitnessScore,
    passed: passedFixtures,
    failed: failedFixtures,
    meanFailingError,
    tiers: tierStats,
    summary: summaryMessage,
  };
  fs.appendFileSync(trackerPath, JSON.stringify(entry) + "\n");
  console.log(`\n📝 Appended run to tracker.jsonl`);

  if (hasRegression) {
    console.log(
      "\n⚠️ Auto-reverting changes due to regression on locked test(s)...",
    );
    try {
      execSync("git checkout -- src/", { stdio: "inherit" });
      console.log("✅ Reverted src/ directory to HEAD.");
    } catch (e) {
      console.error("❌ Failed to auto-revert:", e);
    }
    process.exit(1);
  } else if (failedFixtures > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
