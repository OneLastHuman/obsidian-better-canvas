# Sketch Theme Implementation Plan

> Historical record from 2026-10-22. Task instructions and authorizations below belong to that implementation. See the [archive index](../README.md) and [current feature matrix](../../INTEGRATION_MATRIX.md).

> **Execution record:** Implemented in the existing feature worktree. The user instructed not to use subagents.

**Goal:** Ship the approved hand-drawn Canvas theme and six functional presets.

**Architecture:** Add `bcTheme: "sketch"` to the existing per-Canvas theme mechanism. A pure sketch-style module owns preset resolution and deterministic Rough.js SVG generation; a DOM decorator layers visuals onto native nodes/edges without changing interaction geometry. Existing theme controller and style panel provide controls, history and editor synchronization; static export shares sketch geometry.

**Tech Stack:** TypeScript, Obsidian Canvas, Rough.js 4.6.6, local OFL Chinese handwriting font, Vitest.

**Spec:** [Preset design](../../design/excalidraw-presets.design.md); visual reference [HTML prototype](../../design/excalidraw-theme.prototype.html).

## Global Constraints

- Preserve approved six IDs: `heading`, `concept`, `action`, `decision`, `annotation`, `risk`.
- Use the accepted CEF handwriting font with production glyph coverage, not the prototype-only subset; bundle locally and retain OFL attribution.
- Preserve content, geometry, unknown fields, edges and other themes. Preset application may change selected nodes' visual style fields only. Groups are excluded from preset application.
- Theme/preset actions support readonly, multi-selection, mixed states, save/reopen, undo/redo and cleanup.
- Native right-click menu and rectangular interaction geometry remain native. SVG visuals are pointer-events:none and seeded by ID, stable across redraws.
- Current isolated worktree is already valid. Preserve all prototype files. The user requested a commit and push of this feature branch; do not merge or release it.
- Obsidian E2E is serial. No subagents were used. The controller owns integration and evidence.

## Review Focus

1. Theme switch/unload removes injected paths, fonts/editor styles and listeners; no duplicate decorations.
2. Resizing and native edge path changes regenerate outlines without moving endpoints or intercepting interaction.
3. Explicit style adjustments after preset application remain effective; shape/fill/size survive reopen and history.
4. Chinese characters not present in demo render in the bundled production font; light/dark editor contrast remains readable.
5. Full/selection SVG export preserves sketch theme and safely escapes content without remote font dependencies.

## Task 1: Core data and renderer

Owner files: new `src/sketch-style.ts`, `src/sketch-renderer.ts`, related tests, `src/canvas-theme.ts`, `src/canvas-theme.test.ts`, `package.json` (roughjs dependency only).

Interfaces: `SKETCH_PRESETS` definitions with id/label/sample/style; `applySketchPreset(data: CanvasData, ids: readonly string[], preset: string): {data: CanvasData; updated: number}`; `resolveSketchStyle(node: CanvasNodeData)` for resolved preset/shape/fill/color/border/align/fontSize. Store `bcSketchPreset`, `bcSketchFill`; use standard existing bcShape/bcBorderStyle/bcTextAlign/color fields for overrides. Export `renderSketchNodeSvg(node: CanvasNodeData): string` local-coordinate SVG markup and `renderSketchPathSvg(path: string, id: string, color: string, dash?: string): string` deterministic path markup. `decorateSketchCanvas(canvas)` and `clearSketchCanvas(canvas)` are DOM-only, called by theme decoration/controller. Renderer may refine signatures and document them in report before dependent tasks start.

- [x] Add focused tests for preset exact combinations, immutability, groups/missing IDs, malformed preset and explicit overrides.
- [x] Add roughjs 4.6.6; implement presets and stable geometry with no live DOM dependency in SVG helpers.
- [x] Implement scoped node/edge decoration and teardown. Theme resolver supports sketch. DOM access must feature-detect fake test hosts.
- [x] Verify focused tests, typecheck and report interfaces + limitations.

## Task 2: Theme controls, CSS and panel

Owner files: `src/canvas-theme-controller.ts`, `src/node-menu-unifier.ts`, corresponding tests, `styles.css`, small necessary `src/enhancements.ts` integration if needed. Consume Task 1 interfaces; controller supplies production font module `src/sketch-font.ts` exporting `SKETCH_FONT_CSS` and `SKETCH_FONT_FAMILY`.

- [x] Add sketch choice/preview to native theme control and all labels.
- [x] Add six preview presets to style panel, multi-select/mixed/empty/readonly behavior, fill options none/solid/hachure/cross-hatch; use existing history operations.
- [x] Style canvas light/dark, nodes, groups, labels, selected states and preview thumbnails using actual renderer. Same-origin editor iframe gets font and theme text styles; theme switch and unload restore styles.
- [x] Test theme switch cleanup, panel batch apply, history and explicit override behavior. Verify targeted tests/typecheck.

## Task 3: Static export

Owner files: `src/full-canvas-export.ts`, its tests, `src/canvas-export-data.ts` and tests only if needed. Consume Task 1 and font interfaces.

- [x] Preserve sketch metadata when making selection export data.
- [x] Render sketch node/edge geometry, headings/annotations and handwriting in full/selection SVG; honor export background options.
- [x] Add tests for six presets, deterministic rendering, escaped labels, selection metadata, non-sketch regression. Run targeted tests/typecheck.

## Task 4: Integration, documentation, independent review and desktop validation

Controller owns font assets/build integration, docs/FEATURE_GUIDE.md, docs/INTEGRATION_MATRIX.md, final checks and coordination.

- [x] Prepare local production font with common Chinese coverage and OFL notice; build embeds it into `main.js` without external runtime requests.
- [x] Run lint, validate:metadata, typecheck, tests and build; inspect full diff and asset footprint.
- [x] Review the diff against the spec and inspect implementation and runtime behavior. No subagent review was used, per the user's instruction.
- [x] Serial Obsidian validation using a dedicated test Canvas: six presets, Chinese font, editing, edges, save/reopen, undo/redo, theme switching, readonly and group behavior, light/dark rendering, SVG/PNG export and errors. Screenshots are outside the repository.
- [x] Update feature guide and matrix with the actual verification boundary; leave reviewable changes on the feature branch.

## Execution ledger

- Baseline: `4f99aa61e0d52bf5c2e77693fefaf41e7b4940d4`; prototype files are task work, not discarded.
- Existing worktree verified by `git worktree list`; use it in place.
- Interface scan: Task 1 → 2/3 share sketch-style/render helper signatures; dependent tasks wait for core report. Tasks 2/3 own disjoint files. Font interface owned by controller. Task 4 reviews all integration points.
- User approved design and explicitly requested implementation; proceed without a second design approval.
- Final validation: `npm run lint` (0 errors; warnings remain), `npm run typecheck`, `npm test` (67 files / 467 tests), `npm run build`, `npm run validate:metadata`, and `git diff --check` passed.
- Obsidian Desktop 1.14.4 on Windows: theme/preset persistence, bundled font at weight 600, same-origin editor font, preset application, read-only rejection, group exclusion, undo/redo, light/dark, theme cleanup and full/selection SVG plus full PNG export checked. `dev:errors` was clean after clearing earlier editor lifecycle errors from exploratory iframe closing.
- The user requested commit and push after implementation. The branch is not merged and no release was made.
