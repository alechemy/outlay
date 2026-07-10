# Outlay adoption validation plan

## Objective

Determine whether Outlay solves an important enough problem to justify continued
product development. Validate demand before expanding CSS coverage or building a
full Satori or Takumi competitor.

Run this as a four-to-six-week validation effort. GitHub stars and npm downloads
are supporting signals, not the primary success criteria.

## Current assessment

Outlay has a credible technical core:

- Pure synchronous JavaScript
- Flexbox and CSS Grid
- Inspectable layout boxes
- Browser-free operation
- Extensive comparison against Chromium

The unproven assumption is that users specifically need this combination. The
headless image-rendering market is already served by Satori and Takumi. Takumi
supports Grid plus JSX, HTML, images, text shaping, raster output, SVG, and
multiple runtimes. Do not pursue feature parity without strong user evidence.

The most promising initial audience is authors of JavaScript rendering
infrastructure such as SVG, canvas, PDF, diagramming, editor, and testing tools.
The proposed wedge is:

> Inspectable, browser-like Flexbox and CSS Grid layout boxes in pure synchronous
> JavaScript, without a DOM, WASM, or native binaries.

## Operating constraints

- Do not add speculative layout features during validation.
- Do not build a general-purpose image renderer.
- Do not optimize for stars before confirming repeat usage.
- Do not publish posts, contact maintainers, or write to remote services without
  Alec's explicit approval.
- Verify current competitor features and metrics before publishing comparisons.
- Describe accuracy as applying to the tested vocabulary. Do not imply complete
  browser compatibility.

## Workstream 1: Fix positioning and trust issues

### Tasks

1. Audit `README.md`, `pages/index.html`, `package.json`, and npm/GitHub metadata.
2. Choose one primary story. Prefer the low-level layout engine until demand for
   another use case is demonstrated.
3. Prepare a diff that:
   - Updates the homepage fixture count.
   - Removes or qualifies the homepage's "zero dependencies" claim.
   - Aligns the homepage, README, repository description, and package description.
   - Replaces broad browser-matching claims with tested-subset language.
   - Adds Takumi to relevant competitive comparisons.
   - Adds relevant discovery terms such as `css-layout-engine`, `headless-layout`,
     `svg-layout`, `canvas-layout`, `pdf-layout`, and `browser-free`.
   - Shows a real target use case before the generic `solveLayout` example.
4. Create a concise compatibility matrix covering supported behavior, verified
   behavior, known divergences, and deliberate non-goals.

### Deliverables

- A messaging brief with one audience, one problem, and one differentiator.
- A proposed documentation and metadata diff.
- A compatibility matrix that can be linked from the README.

### Acceptance criteria

- A new visitor can identify the target user and job within ten seconds.
- Claims remain accurate when read alongside the known gaps.
- The project does not present itself as a stronger end-to-end renderer than
  Takumi or Satori.

## Workstream 2: Find evidence of demand

### Tasks

1. Build a prospect list of 30 projects across:
   - SVG and canvas renderers
   - PDF and report generators
   - Diagramming and whiteboard tools
   - Editor and design-tool infrastructure
   - Headless component or layout testing
   - Serverless or sandboxed runtimes
2. For every prospect, record:
   - Project and maintainer
   - Current layout approach
   - Whether it uses DOM, Yoga, Taffy, WASM, native code, or custom arithmetic
   - Concrete evidence of a layout limitation
   - Why Outlay might fit
   - Public contact or discussion path
3. Rank prospects by evidence of pain. Do not rank by repository popularity alone.
4. Identify at least 15 prospects with a documented limitation or open request.

### Deliverables

- A prospect table with sources.
- A prioritized shortlist of 15 strong candidates.
- A summary of repeated problems and rejected hypotheses.

### Acceptance criteria

- Every shortlisted prospect has evidence beyond a hypothetical use case.
- At least three prospects share the same specific problem.

## Workstream 3: Conduct discovery

### Tasks

1. Draft a short outreach message that asks about the maintainer's current
   problem. Do not lead with a product pitch.
2. Draft a 20-minute interview guide covering:
   - What they render and where it runs
   - Their current layout implementation
   - Problems with DOM, WASM, native binaries, or async initialization
   - Whether CSS Grid or browser fidelity matters
   - Whether they need boxes, SVG, or final pixels
   - What would prevent adoption
3. After approval, contact the highest-ranked prospects.
4. Record exact answers and distinguish requested capabilities from polite
   interest.

### Deliverables

- Outreach copy ready for approval.
- Interview guide.
- Structured notes and a findings summary.

### Acceptance criteria

- At least ten substantive maintainer or user conversations.
- At least three independent confirmations of the same painful job.
- At least two users willing to try an integration against real project data.

## Workstream 4: Build evidence-driven integrations

Only begin this workstream after discovery identifies concrete users.

### Tasks

1. Select no more than two integrations requested by prospective users.
2. Build the smallest adapter that exercises Outlay in the user's actual pipeline.
3. Include a runnable example, realistic input, expected output, and measured
   deployment or performance characteristics.
4. Document what Outlay replaces and what the user must still provide.
5. Ask the user to run the integration without assistance and record friction.

Potential adapter categories include:

- Layout boxes for an SVG or canvas scene graph
- Grid layout for a PDF or report generator
- A synchronous layout backend for a restricted JavaScript runtime
- A bridge from an existing component or style representation

### Acceptance criteria

- The integration removes existing code or operational complexity.
- A user outside the project can run it from the documentation.
- The user returns to it for a second real task.

## Workstream 5: Distribution based on proof

Do not lead with a generic launch announcement.

### Tasks

1. Write one technical case study around a validated integration.
2. Include:
   - The original problem
   - The previous approach
   - Why browser, Yoga, Taffy, or custom layout was unsuitable
   - The complete working integration
   - Accuracy, package size, startup, and runtime measurements
   - Honest limitations
3. Prepare channel-specific drafts for the communities connected to that use case.
4. Publish only after approval.

### Acceptance criteria

- The case study demonstrates a completed user job, not only fixture accuracy.
- Readers can reproduce the result from a small public example.
- Calls to action ask for integrations and problem reports rather than stars.

## Product changes to consider only when validated

Prioritize these according to observed adoption blockers:

1. Runtime support below Node 22 if the core can support it safely.
2. Explicit browser, worker, Bun, and Deno compatibility documentation.
3. Input adapters that avoid recreating production layouts by hand.
4. Better diagnostics that identify unsupported or divergent behavior.
5. Incremental layout only if interactive-tool users require it.
6. Rendering features only if users choose Outlay specifically for rendering.

If rendering becomes the validated wedge, the minimum competitive requirements
are likely JSX or component input, images, gradients, shadows, font shaping,
fallback fonts, emoji, and a straightforward raster-output path. Treat that as a
separate product decision because it means competing directly with Takumi and
Satori.

## Decision gate

Continue active product development if the validation period produces either:

- Three independent external integrations, or
- One recurring production user plus two active trials

Continue cautiously if interviews confirm a repeated problem but integrations
are blocked by one narrow, feasible capability.

Freeze the project as maintained infrastructure or a portfolio artifact if:

- Prospects consistently accept DOM, WASM, native, Yoga, or Taffy solutions.
- CSS Grid is described as useful but not important enough to switch.
- Users want a complete rendering stack rather than layout boxes.
- No independent user adopts it after targeted outreach and two requested
  integration attempts.

## Final report

At the end of the validation period, produce a short decision document containing:

- Confirmed user and job
- Strongest evidence for and against continued investment
- Integrations attempted and retained
- Adoption blockers
- Recommended positioning
- Continue, narrow, or freeze decision
