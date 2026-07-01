# Session Prompt: Close the Remaining Vocabulary Coverage Gaps

Read `CLAUDE.md` first (ground truth hierarchy, iteration loop, known gaps). This session locks the two remaining claimed-but-never-generated behaviors found by the 2026-07-01 vocabulary audit. Everything stays local: no `git push`, no npm publish.

## Baseline

Run `npm run test` and confirm all tiers green (1625/1625 across Tiers 1–14 as of 2026-07-01).

## Work order

Take the next unused tier number(s) (`ls fixtures | grep -o 'tier-[0-9]*' | sort -Vu | tail -1`) and update PROJECT.md's Phase 3 grid-tier reservation accordingly. Never regenerate an existing tier — locked fixtures are history.

### 1. Keyword sizing coverage (`min-content` / `max-content`)

Current coverage is tier-8 container *widths* only (~17 fixtures). Uncovered: keyword `height` on containers, and keyword `width`/`height` on flex items. One new tier (~100 fixtures):

- Containers with `height: min-content` / `max-content` in both row and column direction (main-axis and cross-axis keyword sizing).
- Items with keyword widths/heights, mixed with grow/shrink and gap.
- Probe first (`npm run probe`): item-level keyword sizing has never been exercised — establish what Chromium does before assuming the solver's `computeIntrinsicContentSize` path handles it. If it turns out unimplemented and large, implement via the existing intrinsic-size machinery (Pretext pattern 1: intrinsic size as a degenerate layout pass — no separate code path); if it is genuinely out of scope, say so in README and CLAUDE.md Known gaps. Do not leave it silent.

### 2. Block-with-children inside flex trees

`display: block` nodes with children are only generated as tier-1 roots. A block container nested as a flex item exercises the solver's block layout branch in `emitBoxes` in a position no fixture covers. One new tier (~75 fixtures):

- Flex containers whose children include block containers with their own block/flex children.
- **Margin collapse warning**: the solver does not implement sibling or parent/child margin collapse; tier 1 deliberately generates collapse-preventing padding/borders. First category: reuse those guards to lock the collapse-free behavior. Second category: generate colliding margins, see what fails, then decide — implement collapse (probe Chromium; the rules inside a flex item's block formatting context still apply) or document block margin collapse as a non-goal in README. Either way the decision must be written down.

### 3. Literal `"auto"` strings (cheap)

`width`/`height`/`flexBasis` accept literal `"auto"` (and `flexBasis: "content"`), which the generator never emits; the solver treats any non-number as auto. In whichever new tier is convenient, emit literal `"auto"` on a random ~15% of nodes to lock the equivalence, then remove the corresponding note from CLAUDE.md Known gaps.

## Acceptance criteria

- New tiers 100%, all prior tiers still 100%, `npm run bench` targets still met, `npm run verify:explorer` still 31/31.
- Every audit finding either fixture-covered or explicitly documented as a non-goal — nothing silent.
- CLAUDE.md Known gaps rewritten to reflect what this session closed; README updated if scope decisions were made.
- Single-line commits in the existing `feat:`/`fix:` style, committed per fitness improvement.
