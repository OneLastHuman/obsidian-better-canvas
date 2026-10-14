# Integration feature matrix

This matrix records the current implementation in Better Canvas. “Implemented” means code exists; it does not imply that every supported Obsidian version, provider endpoint, or internal DOM patch has been manually validated.

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
| Editable Canvas Portal | Implemented, basic / single level | Mirrors nodes/edges from another `.canvas` with isolated IDs, syncs edits/deletions back to the source, and maps cross-portal edges to the frame. The command `在选中 Canvas Portal 中创建文本节点` adds a new text node and edge directly to the source Canvas, then refreshes mirrors. Arbitrary nodes created by clicking inside the Portal are not automatically assigned to it; nested Portal expansion is still deferred. Source sync uses Obsidian internal view serialization and needs desktop validation |
| PDF page splitting / fixed page rendering | Implemented, basic | Pinned PDF pages are rendered into Canvas file nodes through Obsidian's PDF embed registry |
| PDF pen / highlighter / eraser / undo | Implemented, basic | Red/blue pens, yellow highlighter, path eraser, undo-last-stroke and clear-all; stored in Canvas JSON. Selection, resize, touch input and rotated pages need manual tests |
| Full PDF annotation tools (highlighter, text selection, multipage toolbar) | Partial | Pinned pages render a transparent selectable text layer and create quoted excerpt nodes; the new “对所选 PDF 页面执行 AI OCR” command transcribes a selected/pinned page through a vision-capable model. Persistent PDF-native highlight annotations, automatic batch OCR for whole documents and a full multipage annotation toolbar remain incomplete |
| Canvas frontmatter property editor | Implemented, basic | Command adds/updates/deletes one JSON-valued frontmatter property at a time; a richer multi-property editor and schema validation remain |
| Alternative text renderer / remaining advanced export settings | Partial, expanded | Viewport PNG/SVG scale and background are configurable. New full-content SVG/PNG export uses the union of all node bounds and renders common shapes, text and edges without using the current viewport. Media/PDF file contents and live HTML previews render as labels, not embedded content; a separate Markdown renderer and full parity with Obsidian's DOM renderer remain incomplete |

## AI Canvas

| Feature | Status | Notes |
|---|---|---|
| Ask AI from a selected node | Implemented | Adds a progressively updated response node connected to the source |
| Stop in-flight generation | Implemented, transport-dependent | Uses AbortController for streaming fetch; a fallback non-streaming request may not be cancellable |
| Regenerate response | Implemented | Requires Better Canvas generation metadata on the response node |
| Per-node provider / model overrides | Implemented | Stores provider and model identifiers on the node |
| Multiple provider profiles | Implemented | Native OpenAI-compatible, Anthropic Messages and Gemini adapters; providers with unsupported APIs may need a compatible gateway |
| Connected image / pinned PDF page vision context | Implemented, basic | Sends up to four connected local image files or rasterized pinned PDF pages. Remote image URLs are not fetched automatically |
| Image generation to Vault | Implemented, provider-dependent | OpenAI-compatible Images endpoint or compatible Gemini image model; not every gateway supports it |
| Related research questions / title generation / idea expansion | Implemented | Uses model-produced structured responses |
| Flashcard generation | Implemented | Can create flashcard nodes; does not directly create a spaced-repetition deck |
| Webpage text ingestion | Implemented, best-effort | JavaScript-only, login-gated and anti-bot pages may fail |
| YouTube caption ingestion | Implemented, best-effort | Requires accessible captions; videos without retrievable captions cannot be transcribed |
| MCP tools | Implemented, Streamable HTTP, legacy SSE, and local stdio | Direct tool picker plus AI-proposed tool/arguments with an explicit review/confirmation step. Text results become linked nodes; PNG/JPEG/WebP/GIF image results are saved into the Vault and added as linked file nodes. Local stdio uses a configured executable/args/env/cwd and starts a fresh process per list/call operation. SSE checks that the message endpoint stays on the configured origin before sending credentials; unsupported image MIME types are skipped |
| PDF page context for AI | Implemented, basic | Extracts selectable text from up to three pages and sends pinned-page raster images to visual models; scanned PDFs without OCR text depend on visual input and model support |
| Gemini-native public YouTube video context | Implemented, provider-dependent | Command sends `fileData.fileUri` directly to the active Gemini profile; the video must be public and the selected model/account must support it |
| Provider model discovery and per-node model picker | Implemented, provider-dependent | Queries OpenAI-compatible `/models`, Anthropic `/models`, or Gemini `/models`; falls back to manual model entry when the endpoint is unavailable |
| Local Codex CLI | Implemented, desktop-only | Runs the configured executable with `codex exec --json --ephemeral --skip-git-repo-check --sandbox read-only -`; uses a temporary working directory, no shell wrapper, timeout and cancel support. Requires an installed/logged-in CLI and uses the provider configured in Codex |
| Batch prompt for a folder | Implemented, capped | Recursively processes up to 20 Markdown files per invocation; displays each result as a file-linked Canvas node. File text is sent to the configured provider only after the user selects a folder and submits a prompt |
| Sandboxed interactive HTML preview | Implemented, basic | HTML fenced blocks expose a toggleable sandbox iframe without `allow-same-origin`, forms, popups, or top navigation. Remote-resource behavior and very complex demos still require manual checks |
| All upstream model/provider SDKs, rich model picker and automatic tool routing | Partial | Model discovery is available for three API protocol families; the plugin does not embed every upstream AI SDK or automatically route arbitrary tool calls |

## Build and verification

- GitHub Actions runs `npm install`, `npm run typecheck`, `npm test` and `npm run build` on pushes and pull requests to `main`.
- CI verifies TypeScript, helper tests and the production bundle.
- Recent additions include provider model-list normalization, HTML-fence extraction, Codex JSONL event parsing and local MCP stdio configuration validation tests; a passing CI run still does not replace Obsidian GUI/device verification.
- CI does not run Obsidian itself. Before releasing, manually test Canvas persistence, keyboard shortcuts, native menus, metadata/backlinks, PDF annotations, image export and real provider requests on the intended desktop/mobile versions.
