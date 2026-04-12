import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { solveLayout } from "../src/solver";

function runTests() {
  const fixturesDir = path.join(import.meta.dirname, "..", "fixtures");
  if (!fs.existsSync(fixturesDir)) {
    console.error(`Fixtures directory not found: ${fixturesDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.error("No fixtures found. Run generator first.");
    process.exit(1);
  }

  const lockedTestsPath = path.join(import.meta.dirname, "locked_tests.json");
  const lockedTests: string[] = fs.existsSync(lockedTestsPath)
    ? JSON.parse(fs.readFileSync(lockedTestsPath, "utf-8"))
    : [];

  const newlyPassedTests: string[] = [];
  let hasRegression = false;
  const regressions: string[] = [];

  let passedFixtures = 0;
  let failedFixtures = 0;
  let totalErrorAcrossFailing = 0;

  const tierStats: Record<number, { passed: number; failed: number }> = {};

  type FailingTestInfo = {
    file: string;
    tier: number;
    nodeCount: number;
    meanError: number;
    errors: string[];
  };
  const failingTestInfos: FailingTestInfo[] = [];

  for (const file of files) {
    const fixturePath = path.join(fixturesDir, file);
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));

    const {
      input,
      expected,
      tolerance = 0.5,
      seed,
      tier,
      contentMeasurements,
    } = fixture;
    const nodeCount = Object.keys(expected).length;

    // Attach measureContent callbacks from fixture contentMeasurements
    if (contentMeasurements) {
      function attachMeasureContent(node: any) {
        const data = contentMeasurements[node.id];
        if (data) {
          node.measureContent = (_availableWidth: number) => ({
            width: data.width,
            height: data.height,
          });
        }
        if (node.children) {
          for (const child of node.children) attachMeasureContent(child);
        }
      }
      attachMeasureContent(input);
    }

    if (!tierStats[tier]) {
      tierStats[tier] = { passed: 0, failed: 0 };
    }

    let result;
    try {
      result = solveLayout(input);
    } catch (e) {
      failedFixtures++;
      tierStats[tier].failed++;
      const errorMsg = e instanceof Error ? e.stack ?? e.message : String(e);
      if (lockedTests.includes(file)) {
        hasRegression = true;
        regressions.push(file);
      }
      totalErrorAcrossFailing += 1000;
      failingTestInfos.push({
        file,
        tier,
        nodeCount,
        meanError: 1000,
        errors: [`  [EXCEPTION] ${errorMsg}`],
      });
      continue;
    }

    let fixtureFailed = false;
    const errors: string[] = [];
    let testTotalError = 0;
    let testErrorCount = 0;

    for (const [nodeId, expectedBox] of Object.entries(expected)) {
      const actualBox = result.boxes.get(nodeId);

      if (!actualBox) {
        fixtureFailed = true;
        errors.push(`  [${nodeId}] Missing in solver output.`);
        testTotalError += 1000;
        testErrorCount++;
        continue;
      }

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

      failingTestInfos.push({ file, tier, nodeCount, meanError: testMeanError, errors });

      if (lockedTests.includes(file)) {
        hasRegression = true;
        regressions.push(file);
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

  // Sort failing tests by priority (tier, then node count, then error)
  failingTestInfos.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.nodeCount !== b.nodeCount) return a.nodeCount - b.nodeCount;
    return a.meanError - b.meanError;
  });

  // Write detailed failure log
  const failureLogPath = path.join(import.meta.dirname, "last_run_failures.log");
  if (failingTestInfos.length > 0) {
    const lines: string[] = [
      `Test run: ${new Date().toISOString()}`,
      `Failed: ${failedFixtures}/${totalTests}`,
      "",
    ];
    for (const info of failingTestInfos) {
      lines.push(
        `❌ ${info.file} (Tier ${info.tier}, Nodes: ${info.nodeCount}, Mean Error: ${info.meanError.toFixed(4)}px)`,
      );
      lines.push(...info.errors);
      lines.push("");
    }
    fs.writeFileSync(failureLogPath, lines.join("\n"), "utf-8");
  } else if (fs.existsSync(failureLogPath)) {
    fs.unlinkSync(failureLogPath);
  }

  // --- Concise console output ---

  if (regressions.length > 0) {
    console.log("\n🚨 REGRESSIONS DETECTED:");
    for (const f of regressions) console.log(`   ${f}`);
  }

  console.log("\n--- Test Summary ---");
  console.log(`Total:  ${totalTests}  |  Passed: ${passedFixtures}  |  Failed: ${failedFixtures}`);
  console.log(`Fitness Score: ${fitnessScore.toFixed(6)}`);
  console.log(`Mean Error Across Failing Tests: ${meanFailingError.toFixed(4)}px`);

  // Tier breakdown (compact)
  const tierNums = Object.keys(tierStats)
    .map(Number)
    .sort((a, b) => a - b);
  const tierLine = tierNums
    .map((t) => `T${t}: ${tierStats[t].passed}/${tierStats[t].passed + tierStats[t].failed}`)
    .join("  ");
  if (tierLine) console.log(`Tiers: ${tierLine}`);

  if (failingTestInfos.length > 0) {
    console.log("\n--- Top Priority Failing Tests ---");
    for (const info of failingTestInfos.slice(0, 5)) {
      console.log(
        `  ${info.file} (Tier ${info.tier}, Nodes: ${info.nodeCount}, Mean Error: ${info.meanError.toFixed(4)}px)`,
      );
    }
    console.log(`\n  Full details: tests/last_run_failures.log`);
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

  const trackerPath = path.join(import.meta.dirname, "tracker.jsonl");
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
  console.log(`📝 Appended run to tracker.jsonl`);

  if (hasRegression) {
    console.log(
      "\n⚠️ Regression detected on locked test(s). Stashing changes instead of discarding...",
    );
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const stashMessage = `regression-${timestamp}`;
      execSync(`git stash push -m "${stashMessage}" -- src/`, {
        stdio: "inherit",
      });
      console.log(`✅ Changes stashed as "${stashMessage}".`);
      console.log(
        `   To recover and refine: git stash pop  (or: git stash list)`,
      );
    } catch (e) {
      console.error("❌ Failed to stash changes:", e);
    }
    process.exit(1);
  } else if (failedFixtures > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
