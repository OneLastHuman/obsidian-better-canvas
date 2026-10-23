# Scrapbook Theme Implementation Plan

> Historical record from 2026-10-21. Task instructions and checkboxes below belong to that implementation. See the [archive index](../README.md) and [current feature matrix](../../INTEGRATION_MATRIX.md).

> **For agentic workers:** Use executing-plans to implement the tasks in order. Track completion below.

**Goal:** Deliver a working, per-Canvas scrapbook theme for immediate Obsidian desktop evaluation.

**Architecture:** Store `bcTheme` on Canvas data and `bcScrapbookPreset` on nodes. Theme rendering decorates the existing Canvas DOM; native geometry, explicit node/edge styles and content stay intact. A Canvas control opens a theme picker; the existing node panel shows scrapbook presets when active.

**Tech Stack:** Existing TypeScript, CSS, Obsidian Canvas and Vitest. No new dependencies.

**Spec:** User approved the theme classification and requested implementing scrapbook first on the real app. Scope: default/scrapbook switch, warm paper board, tape/lined/torn/photo/label presets, coordinated edges and groups, persistence and undo. Other themes, global default settings, preset editor and full SVG texture export are deferred.

## Global Constraints

- Preserve nodes, edges, explicit colors, shapes, borders, content and coordinates on theme switch.
- Scope the light paper surface to this Canvas, including when Obsidian uses dark mode.
- Keep native context menus and rectangular interaction geometry intact.
- Handle read-only Canvas, empty Canvas, unknown theme IDs, plugin unload and reopening.
- Validate on the test Vault `I:\AI\obsidian canvas explore` only.

## Review Focus

- Theme must survive native save and undo/redo, including returning to an old snapshot without a theme.
- Selecting a preset must preserve unrelated node extension fields and explicit styles.
- Text inside the Obsidian editing iframe must remain readable in dark mode.
- Theme must not leak to another Canvas or survive removal of the plugin.
- Decorative tape must not intercept dragging, resizing, selection or editing.

### Task 1: Data and presets

Files: create `src/canvas-theme.ts`, `src/canvas-theme.test.ts`.

- [x] Write and run failing tests for theme fallback, immutable theme changes and preset application preserving explicit styles/unknown fields.
- [x] Implement `resolveCanvasTheme(data)`, `withCanvasTheme(data, theme)` and `applyScrapbookPreset(data, ids, preset)`.
- [x] Run targeted tests and confirm pass.

### Task 2: Runtime and controls

Files: `src/canvas-theme.ts`, `src/node-menu-unifier.ts`, `src/enhancements.ts`, `styles.css`, panel tests.

- [x] Test theme-aware preset actions, multi-selection and read-only rejection.
- [x] Add a theme control and picker, synchronize native history/imports and decorate existing/new nodes and edges.
- [x] Render five distinct scrapbook treatments with shared preview styles; keep explicit colors and shape borders effective.
- [x] Verify targeted tests and typecheck.

### Task 3: Real-device evaluation

Files: `docs/FEATURE_GUIDE.md`, `docs/INTEGRATION_MATRIX.md`.

- [ ] Run lint, metadata validation, typecheck, full tests and build; inspect diff.
- [ ] Deploy to test Vault, verify picker, presets, persistence, undo, light/dark host, new nodes, selection and clean errors; capture screenshots.
- [x] Independent review and resolve significant findings.
- [ ] Document limits and leave a clearly named demo Canvas for user evaluation (requested deliverable, not disposable fixture).

## Execution record

- Baseline `ea430a0`; isolated branch `feat/scrapbook-theme`; 63 files / 438 tests pass.
- Ruling: inline implementation follows the user's request to implement quickly; no extra design approval round.
- Ruling: preserve a demo board for user evaluation; delete only disposable verification boards.
- Ruling: local work only; no GitHub messages or publication without user instruction.
- User refinement: this is a high-fidelity, usable theme, not a throwaway mockup. Added paper grain, shared treatment previews, muted palette, editor iframe styling, coordinated native controls and local original SVG artwork.
- Native history fix: `requestSave(false)` plus immediate snapshots avoids duplicate debounced undo steps. Regression test failed then passed; native one-step theme/preset undo and theme redo passed.
- Review fixes: all decorated canvases are tracked independently of controls for cleanup (failing lifecycle regression then green); explicit borders suppress torn clipping; selection outline uses the anchor; explicit solid group border works; data-load events refresh an open style panel.
- Ruling: explicit border wins over torn perimeter so dashed/double strokes stay intact; selecting a hand border trades the torn edge for a complete rectangular outline.
- Review boundaries: real dark editor, save/reopen, history, new-node paper rendering and SVG image frame were checked in Obsidian 1.14.4. Static export fidelity, third-party themes, PDF/remote embeds and mobile are unverified. Native physical drag/resize gestures remain unverified; attempted CDP gestures did not move the intended card.
- Evidence outside repository: `%LOCALAPPDATA%/Temp/opencode/obsidian-e2e/scrapbook-theme/`. Demo board and original SVG in the test Vault are retained for the user's requested evaluation. No disposable verification boards remain.
