# TODO

## Release process

- [ ] Write the `## <version>` CHANGELOG.md section *before* running
      `npm version` — the tag-triggered release workflow checks out the tag
      and extracts release notes from that commit's CHANGELOG.md, so a bare
      version-bump tag fails the "Create GitHub release" step (as v1.4.0 did;
      its GitHub release was created manually from a follow-up commit).

Rendering-track (v1) limitations worth revisiting. Solver-level gaps and
non-goals are tracked in CLAUDE.md under "Known gaps and non-goals" — this file
does not duplicate them.

## outlay/render (`src/render.ts`, render-mode `src/html.ts`)

- [ ] A root element that is itself a text leaf solves to height 0 (the block
      auto-height gap applies at the root). Workaround: wrap the text in a
      sized container. Could special-case the root in `htmlToLayout` by sizing
      it from its own `measureContent`.
- [ ] Border strokes paint only for uniform, non-zero border widths; per-side
      widths or colors paint nothing. Per-side composition would need four
      overlay rects (or a path) instead of one inset rect.
- [ ] `border-radius` is a single px value — no per-corner radii, no
      percentages. The inset stroke also shrinks the corner radius by
      strokeWidth/2 rather than modeling inner/outer curvature separately.
- [ ] No font fallback chain: `font-family` uses the first comma-separated
      family only, and a family missing from the `fonts` map throws instead of
      falling through to the next family or `defaultFont`.
- [ ] `font-size` accepts px only; `line-height` accepts px, unitless
      multiplier, or `normal`; `text-align` has no `justify`.
- [ ] Paint vocabulary is solid colors only — gradients, `url()` images, and
      box-shadows are rejected. Growing this means threading `defs` through
      `renderToSvg` (which already accepts them).
- [ ] No `font-style`, `text-decoration`, or `letter-spacing` — they throw
      like any other unsupported property.

## outlay/font (`src/font.ts`)

- [ ] Advances are unshaped and unkerned — exact against Chromium with
      `font-kerning: none`, but default shaping diverges up to ~10px on
      kerning-heavy words ("AVATAR" @31.5px). GPOS pair kerning would close
      most of the gap.
- [ ] TrueType Collections (.ttc) and fonts whose only cmap is format 0 are
      rejected.

## Deliberate non-goals (documented, not planned)

- SVG is the only output; PNG is the caller's rasterizer (`sharp`, `resvg`,
  or a browser). See README "Headless rendering".
- No anonymous boxes: text directly inside an explicit `display: flex`/`grid`
  or mixed with element children throws — wrap text in its own element.
- `parseHTML` strictness is the feature: anything outside the vocabulary
  throws with the element's path, in render mode too.
