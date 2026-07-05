# Session Prompt: Fix the tier-29-290069 Open Edge

Read `CLAUDE.md` first (ground truth hierarchy, iteration loop). This session closes the one known-failing unlocked fixture. Baseline: `npm run test` → 3699/3700; the only failure is `fixtures/tier-29-290069.json` (mean error 1.29px). Delete this file when the fixture passes and the suite is fully green.

## What is already known (do not re-derive — verified 2026-07-05)

The fixture: grid root 418×272, `gridTemplateColumns [240, "auto"]`, `gridTemplateRows ["auto", 84]`, two row-flex middles each holding two text leaves (captured word widths in `fixture.textMeasurements`, lineHeight 20, greedy breaker in `tests/runner.ts`).

Confirmed facts, with a debug harness pattern for reproducing them (solve the fixture with `measureContent` attached the way the runner does, compare `boxes` to `fixture.expected`):

1. **All final item widths match Chromium exactly except node-4**: ours 72.9296875 vs Chromium 72.921875 — a difference of exactly 1/128. 72.921875 is LayoutUnit-clean (72 + 59/64). Diagnosis: **Chromium quantizes the `min-width:auto` text floor (widest word) to LayoutUnit (1/64px), flooring down**; our runner callback returns the raw float capture. Trace confirms node-4 is `min-clamped` at its widest-word floor.
2. **The 10px height cascade**: every reported failure is heights +10. Chain: our grid row 1 is sized by node-5's height contribution (`containerHeightAtWidth(node-5, 368.84375)`), inside which node-7 (width 133.421875, already 64th-clean) wraps to 8 lines → 160 content → outer 201, so our node-5 contribution outer ≈ 253. Chromium's row 1 = 243, which is exactly **node-2's contribution** (node-2 content 195 = node-3's unstretched outer at 6 lines). For Chromium's row to be 243, its node-5 contribution must be ≤ 243, i.e. inside the *contribution* pass Chromium's node-7 wraps to **7 lines, not 8** — even though at the final width 133.421875 the greedy model (verified) gives 8 lines. Chromium's final node-5/6/7 heights are then explained by node-5 being stretched to the 243px row: content 191, its items stretched to line cross 191 (node-6 → 131, node-7 → 150 — neither is a line multiple, both are stretch-derived; do not chase them as wrap heights).
3. Expected heights that ARE wrap-derived: node-3 at 133.421875 → 120 (6 lines) ✓ both engines agree.

So there are two candidate mechanisms for the row discrepancy, to be separated by probing:
- (a) During Chromium's **intrinsic (contribution) sizing** of node-5, node-7's width differs from its final laid-out width (e.g. floors quantized, or shrink resolved at LayoutUnit granularity) by enough to fit one more word per line at a break boundary.
- (b) Chromium's greedy fit uses quantized accumulated line widths (LayoutUnit addition per word) so at width exactly W a line fits one more word than raw-float accumulation allows. Note node-7's width equals its floored widest word — a knife-edge by construction (`cur + space + word <= avail` at exact equality per word).

## Work order

1. **Reconstruct real-text repros.** The fixture's literal strings were stripped at capture. Two options: (i) re-run the generator for seed 290069 with a temporary hook that prints `_text` per node id (the tree is a pure function of the seed — `tests/generator.ts`, `genTextString`), or (ii) build synthetic text whose word widths match the captured `wordWidths` (Arial 16px; pick real words and measure via the probe/canvas until widths land within 1/128). Option (i) is faster and exact.
2. **Probe the minimal case**: a row flex container (node-5's exact box params, width 368.84375) with the two real texts; read Chromium's laid-out line counts and heights (`npm run probe` with stdin HTML). Then the same at node-2's params. Establish Chromium's node-7 line count during *contribution* sizing by probing node-5 nested in a grid `auto` row vs standalone.
3. **Isolate the quantization rule** with targeted probes: a single text item whose widest word has a fractional width, in a shrinking row flex — does Chromium's used width land on floor-to-1/64 of the word width (node-4 says yes)? Does line fitting at exact-equality boundaries admit the word (test a container width equal to sum-of-words at raw float vs at 1/64 floor)?
4. **Encode the discovered rule as a named constant / helper** (Pretext pattern 4) — likely a `LAYOUT_UNIT = 1/64` quantization applied to (at minimum) content-based min floors in `src/solver.ts`, possibly also to the width handed to `measureContent` during intrinsic contribution passes. Keep the blast radius minimal: every change must keep tiers 1–30 green (the regression lock will stash `src/` if not; recover with `git stash pop`).
5. **Also update the fixture-runner/README contract if the rule lives there**: if the correct model is "quantize the available width before greedy fitting," that belongs in the solver (so real Pretext consumers benefit), not in the test callback — decide explicitly and write the decision down.
6. When green: remove the 290069 entry from CLAUDE.md Known gaps, restore the README accuracy line to "all passing at 100%", update the memory of tier-29 being partially open if referenced anywhere, run `npm run bench`, `verify:explorer`, `verify:text-demo`, `test:example`, commit (single-line, no trailers, no push), and delete this file.

## Guardrails

- Probe before reasoning; the spec is secondary; the fixture's `expected` is ground truth.
- If the LayoutUnit hypothesis is wrong, do not force it — the probes in step 2/3 will say what Chromium actually does; follow the evidence.
- If a fix requires quantizing widths broadly and that regresses locked tiers, stop and reassess rather than weakening the lock: sub-1/64 shifts should be invisible at 0.5px tolerance everywhere except knife-edge line breaks, so regressions signal a wrong rule.
- NO code comments beyond a one-line WHY on the named constant. Never push or publish. `rg --color=never` for searches.
