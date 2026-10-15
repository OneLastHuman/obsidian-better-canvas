# Integration feature matrix

This matrix records Better Canvas implementation and parity gaps against the current default branches of Advanced Canvas, Canvas MindMap, and Obsidian AI Canvas. “Implemented” means code exists; it does not imply that every supported Obsidian version, provider endpoint, or internal DOM patch has been manually validated.

**Last reviewed:** 2026-10-15. The code review baseline immediately before this documentation update was `ea95660f61c7af65e35410a38e1774eb82f47080`; its GitHub Actions run passed typecheck, unit tests, production build, and install-package creation. The entries below separate missing feature parity from work that exists but still needs host-runtime verification.

## Canvas MindMap

| Feature | Status | Notes |
|---|---|---|
| Create child, sibling and floating nodes | Implemented | Command palette and Canvas keyboard shortcuts |
| Directional child-node creation | Implemented | Ctrl/Cmd + Shift + arrow |
| Navigate nearby nodes | Implemented | Alt + arrow |
| Select a node tree | Implemented | Selects descendants reachable from the selected root |
| LR / RL / TB / BT layout | Implemented, basic | Cycles are guarded; complex multi-parent graphs may not lay out optimally |
| Convert Markdown H1 headings to nodes | Implemented | Operates on a selected Markdown file node |
| AI-generated mind map | Implemented, basic | Structured JSON response becomes connected nodes; malformed model output may be rejected |
| Independent flashcard nodes | Implemented | Generated content is model-dependent and still needs review |
| Per-edge colors | Implemented, extension metadata | Canvas JSON stores the style; exact display can vary by renderer |
| Shortcut behavior settings | Partial | Core Tab/Enter/Alt-arrow/Ctrl-or-Cmd-arrow flows are present, but there is no dedicated MindMap settings panel for enabling/configuring each inline shortcut as in the upstream plugin |

## Advanced Canvas

| Feature | Status | Notes |
|---|---|---|
| Canvas text / URL / file search | Implemented | Selects the first match |
| Node templates | Implemented | Reusable text-node templates preserve dimensions, colors, Advanced JSON Canvas styleAttributes, shape, border, text alignment, custom class, zoom breakpoint and auto-resize settings |
| Presentation mode | Implemented, basic | Traverses edge-connected nodes, then spatially sorts remaining nodes |
| Node colors / custom palette | Implemented | Includes configurable color slots |
| Node shapes | Implemented, expanded flowchart set | Supports standard shapes plus aliases for terminal, process, decision, input/output and reference; default rectangles omit the non-standard shape attribute, while supported shapes are saved under JSON Canvas `styleAttributes.shape`. Some CSS clip-path shapes may affect node content interaction |
| Borders / text alignment / custom CSS class | Implemented, expanded | Supports solid, dashed, dotted, double and invisible borders; the invisible-border effect is CSS-rendered, while standard border values and text alignment are persisted on Canvas data |
| Edge colors / solid, dashed, dotted path / custom arrow styles | Implemented, basic | Writes both standard `color` / `styleAttributes` and extension fallbacks; exact arrow geometry varies by renderer |
| Flip incident edge direction | Implemented | Reverses edges touching the selected node |
| Select incident edges | Implemented | Supports all, incoming and outgoing edge selection |
| Bring node to front / send to back | Implemented, basic | Uses Canvas data ordering; renderer behavior may differ between Obsidian versions |
| Focus mode / edge emphasis | Implemented, basic | Dims unrelated nodes and edges |
| Create an independent empty group | Implemented | Creates a standalone group node without requiring a selected node |
| Auto-resize text nodes | Implemented, opt-in | Uses estimated text dimensions and DOM observers |
| Align nodes to grid | Implemented | Grid size is configurable |
| Per-node zoom breakpoints | Implemented, basic | Supports a stored per-node threshold and the `--variable-breakpoint` CSS variable |
| Canvas read-only / interaction lock | Implemented, basic | Blocks node/edge interaction but leaves the Canvas surface available; verify panning and zooming on desktop |
| Collapse / expand group | Implemented, basic | Stores contained nodes and incident edges as extension data; restores node geometry and boundary edges, preserves already-collapsed nested groups, and skips restoring edges whose endpoints were deleted while collapsed. Clipboard semantics and complex overlapping groups still need manual testing |
| Encapsulate selection into a new Canvas | Implemented | Re-bases moved nodes near the child Canvas origin, preserves internal edges and reconnects crossing edges to the new file node |
| Export JSON Canvas | Implemented | Saves a separate .canvas file in the Vault |
| Export PNG / SVG | Implemented, configurable | Uses html-to-image against the Canvas DOM; PNG/SVG scale is configurable from 1x to 4x and a transparent or CSS-color background can be selected. Embeds/fonts/very large canvases may need manual testing |
| Copy node Wikilink / embed Canvas node in Markdown | Implemented, basic | Supports `[[file.canvas#node-id]]`; the Markdown post-processor renders text nodes as Markdown, Canvas file nodes as Markdown/image/audio/video/file links and URL nodes as safe external links. Complex interactive embeds and large media still need manual testing |
| Auto edges from file-node frontmatter | Implemented, basic | Reads a configurable key, default `canvas-edges` |
| Metadata cache for .canvas | Implemented, opt-in / internal API | Indexes text-node links, file nodes and Canvas frontmatter for cache/resolved-link consumers. Obsidian upgrade testing required |
| Graph links / backlinks panel | Implemented, supplemental explorer | The `查看当前 Canvas 链接与反向链接` command lists text-node wikilinks, file nodes and safe HTTP(S) links, then scans Markdown metadata and other Canvas JSON for incoming references. Obsidian's built-in Backlinks pane remains internal-API-dependent and needs desktop validation |
| Direct / square / A-star edge pathfinding | Implemented, basic | Writes standard `styleAttributes.pathfindingMethod`, draws custom SVG paths and caches routes; complex nested/group endpoints and all native drag-time behavior need manual testing |
| Floating-side routing | Implemented, basic | Floating endpoints are re-docked to the side facing the other node; recomputation occurs after Canvas interaction |
| Every custom arrow geometry | Implemented, Advanced Canvas named styles | Supports default, triangle-outline, halved-triangle, thin-triangle, diamond/outline, circle/outline, blunt and none; custom SVG polygon fill is renderer-dependent, and native start/end arrow state is persisted for compatibility |
| Full Advanced JSON Canvas style-attribute compatibility | Partial, extensible | A raw JSON editor can preserve arbitrary `styleAttributes` on a selected node or edge; only attributes supported by the active Obsidian renderer will affect appearance, and the entire upstream format is not covered |
| Editable Canvas Portal | Implemented, expanded / single level | Mirrors nodes/edges from another `.canvas` with isolated IDs and syncs edits/deletions back to the source. Newly-created ordinary nodes are adopted when their center falls inside the Portal; newly-created group frames are adopted only when the full rectangle fits inside the Portal content bounds. Same-Portal edges are remapped. Nested Portal expansion and complex crossing edges/source races still require further work and desktop validation |
| PDF page splitting / fixed page rendering | Implemented, basic | Pinned PDF pages are rendered into Canvas file nodes through Obsidian's PDF embed registry |
| PDF pen / highlighter / eraser / undo | Implemented, basic | Red/blue pens, yellow highlighter, path eraser, undo-last-stroke and clear-all; stored in Canvas JSON. Selection, resize, touch input and rotated pages need manual tests |
| Full PDF annotation tools (highlighter, text selection, multipage toolbar) | Partial, expanded | Pinned pages provide selectable text, excerpt nodes, Canvas-persisted pen/highlighter strokes and text selection highlights, plus a direct per-page toolbar for drawing tools, undo and clear. Explicit page-range AI OCR supports up to 20 pages per batch with preflight validation and per-page result nodes. Editing native highlight objects inside the PDF file, one-click OCR of a whole document, and advanced multi-page annotation management remain incomplete |
| Canvas frontmatter property editor | Implemented, expanded | Supports single-property add/update/delete and a full JSON-object editor; the full-object editor validates input and preserves other Canvas/metadata fields. Schema validation remains |
| Alternative text renderer / remaining advanced export settings | Partial, expanded | Viewport PNG/SVG scale and background are configurable. Full-content SVG/PNG export uses all node bounds, renders the built-in flowchart shape set, advanced node/text/edge styling, custom arrowheads, direct/square/obstacle-aware A-star pathfinding, and bounded image/PDF previews. Common Markdown emphasis, links, headings, task markers and lists are flattened to readable text; live HTML remains a label, and full rich Markdown/Obsidian DOM parity remains incomplete |

## AI Canvas

| Feature | Status | Notes |
|---|---|---|
| Ask AI from a selected node | Implemented, command/menu/card toolbar | Adds a progressively updated response node connected to the source; hover toolbar exposes Ask AI, image generation, flashcards and per-node model selection, with regenerate on generated cards |
| Stop in-flight generation | Implemented, transport-dependent | Uses AbortController for streaming fetch; a fallback non-streaming request may not be cancellable |
| Regenerate response | Implemented | Requires Better Canvas generation metadata on the response node |
| Per-node provider / model overrides | Implemented | Stores provider and model identifiers on the node |
| Multiple provider profiles | Implemented | Native OpenAI-compatible, Anthropic Messages and Gemini adapters; providers with unsupported APIs may need a compatible gateway |
| Connected image / pinned PDF page vision context | Implemented, basic | Sends up to four connected local image files or rasterized pinned PDF pages. Remote image URLs are not fetched automatically |
| Image generation to Vault | Implemented, provider-dependent | OpenAI-compatible Images endpoint or compatible Gemini image model; not every gateway supports it |
| Related research questions / title generation / idea expansion | Implemented | Uses model-produced structured responses |
| Flashcard generation | Implemented, partial parity | Creates independent Canvas text nodes. It does not create Markdown flashcard notes/decks or guarantee the file/tag format expected by the Obsidian Spaced Repetition plugin |
| Webpage text ingestion | Implemented, best-effort | JavaScript-only, login-gated and anti-bot pages may fail |
| YouTube caption ingestion | Implemented, best-effort | Requires accessible captions; videos without retrievable captions cannot be transcribed |
| MCP tools | Implemented, Streamable HTTP, legacy SSE, and local stdio | Direct tool picker plus AI-proposed tool/arguments with an explicit review/confirmation step. Text results become linked nodes; PNG/JPEG/WebP/GIF image results are saved into the Vault and added as linked file nodes. Local stdio uses a configured executable/args/env/cwd and starts a fresh process per list/call operation. SSE checks that the message endpoint stays on the configured origin before sending credentials; unsupported image MIME types are skipped |
| PDF page context for AI | Implemented, basic | Extracts selectable text from up to three pages and sends pinned-page raster images to visual models; scanned PDFs without OCR text depend on visual input and model support |
| Gemini-native public YouTube video context | Implemented, provider-dependent | Command sends `fileData.fileUri` directly to the active Gemini profile; the video must be public and the selected model/account must support it |
| Provider model discovery and per-node model picker | Implemented, provider-dependent | Queries OpenAI-compatible `/models`, Anthropic `/models`, or Gemini `/models`; falls back to manual model entry when the endpoint is unavailable |
| Local Codex CLI | Implemented, desktop-only | Runs the configured executable with `codex exec --json --ephemeral --skip-git-repo-check --sandbox read-only -`; uses a temporary working directory, no shell wrapper, timeout and cancel support. Requires an installed/logged-in CLI and uses the provider configured in Codex |
| Local OpenCode ACP text backend | Implemented, desktop-only | Uses `opencode acp` with ACP JSON-RPC, a temporary working directory, timeout/cancel handling and default denial of permission requests. Reuses OpenCode's configured model/login. Text-only: multimodal image/file inputs explicitly require switching to the API backend |
| Batch prompt for a folder | Implemented, capped | Recursively processes up to 20 Markdown files per invocation; displays each result as a file-linked Canvas node. File text is sent to the configured provider only after the user selects a folder and submits a prompt |
| Sandboxed interactive HTML preview | Implemented, basic | HTML fenced blocks expose a toggleable sandbox iframe without `allow-same-origin`, forms, popups, or top navigation. Remote-resource behavior and very complex demos still require manual checks |
| All upstream model/provider SDKs, rich model picker and automatic tool routing | Partial | API model discovery is available for three protocol families, with separate local Codex CLI and OpenCode ACP text backends. The plugin does not embed every upstream AI SDK or automatically execute arbitrary tools; MCP tool suggestions still require user review and confirmation |

## Upstream parity gaps and deferred work

The items below are gaps identified by comparing the current Better Canvas source with the current upstream feature descriptions/source. They are not claims that the entire project is incomplete; several are optional parity targets. “Not implemented” means no equivalent Better Canvas feature was found in the current source review. “Partial” means related functionality exists but does not reproduce the upstream behavior end-to-end.

### Advanced Canvas parity gaps

| Feature | Status | Notes |
|---|---|---|
| Directional clone / expand existing nodes | Not implemented | MindMap-style directional node creation exists, but Advanced Canvas's distinct commands to clone an existing node or expand it in a direction are not implemented as equivalent commands |
| Flip a multi-node selection / swap two nodes | Not implemented | Edge direction flipping exists; geometric flip of a selection and swapping node positions are different operations and are not implemented |
| Pull outgoing links / backlinks into Canvas | Not implemented | The link explorer lists outgoing and incoming references, but does not bulk-create file nodes for selected nodes' links/backlinks or for the whole Canvas |
| Dedicated zoom-to-fit / zoom-to-selection and select-all-edges commands | Partial | Internal actions call `zoomToSelection`, and connected-edge selection is supported. There is no equivalent dedicated command set for zoom-to-fit and selecting every edge on the Canvas; native Obsidian commands may overlap |
| Edge highlight on selecting a connected node | Partial | Focus mode dims unrelated nodes/edges. It does not provide a separate always-available highlight behavior for all edges connected to the selected node |
| Named style presets parsed from CSS snippets | Not implemented | A custom CSS setting, per-node CSS class, and direct style commands exist, but Advanced Canvas-style YAML-in-CSS presets and menu-based selection of those named presets are not implemented |
| Full Better Readonly behavior | Partial | The plugin provides a class-based interaction lock and guards many write operations. It does not expose equivalent independent controls for disabling node menus, locking canvas pan/zoom, and still allowing only the designated fit/selection zoom operations |
| Advanced Canvas custom workspace event API | Not implemented | The plugin listens to Obsidian's built-in Canvas menu/workspace events, but does not publish the upstream `advanced-canvas:*` lifecycle, node, edge, selection, viewport, undo/redo, or save events for other plugins |
| Selection-only image export and upstream export options | Partial | Viewport and full-content PNG/SVG exports exist. There is no equivalent selection-only image export workflow with the upstream privacy-mode / logo-display controls |
| Complete native metadata / global integration parity | Partial | Canvas metadata indexing and a supplementary links explorer exist, but full compatibility with Obsidian's graph, outgoing-links, global search and all per-node metadata-cache behaviors remains internal-API-dependent and has not been established |

### Canvas MindMap parity gaps

| Feature | Status | Notes |
|---|---|---|
| Configurable MindMap shortcut controls | Partial | The primary keyboard flows are implemented, but the plugin does not provide equivalent per-shortcut enablement and configuration controls. Inline DOM shortcuts may also need conflict testing with user hotkeys and themes |
| Optimal layout for arbitrary graphs | Partial | LR/RL/TB/BT tree layout works for basic trees. Multi-parent graphs, cycles, shared descendants and dense non-tree structures may not produce an optimal or stable mind-map layout |

### Obsidian AI Canvas parity gaps

| Feature | Status | Notes |
|---|---|---|
| Named system-prompt library and prompt picker | Not implemented | There is a single global system-prompt setting and task-specific prompts in commands. A library of built-in and user-managed named prompts, with a reusable prompt/context picker, is not implemented |
| Spaced Repetition file/deck integration | Not implemented | Flashcards are represented as Canvas nodes; compatible Markdown notes/decks for the Obsidian Spaced Repetition plugin are not created as a dedicated output mode |
| Per-model capability probing | Partial | Model-list discovery is implemented for OpenAI-compatible, Anthropic and Gemini endpoints. The plugin does not maintain per-provider/model/route capability reports for vision, image generation, PDF, video, YouTube, URL context or search |
| Provider-specific request parameters and model limits | Partial | Core protocol adapters exist, but settings do not expose upstream-equivalent per-model `providerParams`, token/context limits, retry policy and provider-specific tuning. Several request parameters are fixed in code; behavior varies by endpoint |
| Usage, cost and observability integrations | Not implemented | There is no user-facing token/cost accounting, price configuration, request tracing, or equivalent built-in integration for Langfuse, Laminar or a configurable observability service |
| Dedicated card-title / group-title provider configuration | Partial | Title/group naming commands exist, but there are no independent provider, model and system-prompt settings for these tasks like the upstream plugin offers |
| Provider-native URL context / grounding | Partial | Webpage import extracts readable page content on a best-effort basis. It is not equivalent to provider-native URL-context grounding or a first-class workflow that compares independently ingested pages with provider-specific URL support |
| MCP resources and prompts | Not implemented | The current MCP integration focuses on `tools/list` and `tools/call`; resource browsing/reading and prompt discovery/retrieval are not provided |
| Persistent local MCP sessions | Partial | Local stdio starts a fresh child process for each list/call operation. Stateful tools that depend on a long-lived server process or session continuity may not behave like a persistent MCP client |
| Full provider-specific integrations | Partial | Native adapters cover OpenAI-compatible APIs, Anthropic Messages and Gemini. Other services work only where their endpoint/authentication is compatible; dedicated vendor-specific authentication, model capability handling and parameter UI are not covered |

## Build and verification

- GitHub Actions runs `npm install`, `npm run typecheck`, `npm test` and `npm run build` on pushes and pull requests to `main`, then creates the installable ZIP artifact.
- The reviewed source baseline was `ea95660f61c7af65e35410a38e1774eb82f47080`; [workflow run 38675883563](https://github.com/OneLastHuman/obsidian-better-canvas/actions/runs/38675883563) passed typecheck, Vitest, production build, and package upload. The documentation-only commit made by this update triggers its own CI run and must be checked separately.
- The current suite includes focused tests for Canvas data/layout, style and group operations, Canvas frontmatter/links, exports, model discovery, MCP transports/results, Codex/OpenCode protocol handling, PDF page-range parsing and annotation geometry. These are unit/helper tests, not end-to-end feature tests.
- The current main branch includes the unified settings screen, the default-border regression fix, direct PDF annotation toolbar, page-range OCR capped at 20 pages, PDF preview embedding in full-content exports, and expanded JSON Canvas shape/border/text-alignment rendering.
- CI does not launch Obsidian. Real desktop/mobile runtime verification is still required for Canvas persistence, keyboard handling, native menus, theme/DOM compatibility, metadata/backlinks, Portal synchronization, PDF coordinate mapping, actual image export and live provider requests. No real Obsidian GUI run or live provider smoke test is claimed by this matrix.
