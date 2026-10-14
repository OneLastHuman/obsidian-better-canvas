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
| Node templates | Implemented | Reusable text-node templates |
| Presentation mode | Implemented, basic | Traverses edge-connected nodes, then spatially sorts remaining nodes |
| Node colors / custom palette | Implemented | Includes configurable color slots |
| Node shapes | Implemented, basic | CSS-rendered shapes; complex clip-path styling may affect node content interaction |
| Borders / text alignment / custom CSS class | Implemented, basic | Stored on Canvas data and reflected in the plugin's DOM decoration |
| Edge colors / solid, dashed, dotted path | Implemented, basic | Uses plugin-specific edge metadata; custom edge geometry is not implemented |
| Flip incident edge direction | Implemented | Reverses edges touching the selected node |
| Select incident edges | Implemented | Supports all, incoming and outgoing edge selection |
| Bring node to front / send to back | Implemented, basic | Uses Canvas data ordering; renderer behavior may differ between Obsidian versions |
| Focus mode / edge emphasis | Implemented, basic | Dims unrelated nodes and edges |
| Auto-resize text nodes | Implemented, opt-in | Uses estimated text dimensions and DOM observers |
| Align nodes to grid | Implemented | Grid size is configurable |
| Per-node zoom breakpoints | Implemented, basic | Supports a stored per-node threshold and the `--variable-breakpoint` CSS variable |
| Canvas read-only / interaction lock | Implemented, basic | Blocks node/edge interaction but leaves the Canvas surface available; verify panning and zooming on desktop |
| Collapse / expand group | Partial | Stores contained nodes/edges as extension data; nested groups and clipboard semantics need additional tests |
| Encapsulate selection into a new Canvas | Implemented | Creates a child .canvas and replaces the selection with a file node |
| Export JSON Canvas | Implemented | Saves a separate .canvas file in the Vault |
| Export PNG / SVG | Implemented, basic | Uses html-to-image against the Canvas DOM; embeds/fonts/very large canvases may need manual testing |
| Copy node Wikilink / embed Canvas node in Markdown | Partial | Supports `[[file.canvas#node-id]]` and an embed-style preview using a Markdown post-processor |
| Auto edges from file-node frontmatter | Implemented, basic | Reads a configurable key, default `canvas-edges` |
| Metadata cache for .canvas | Implemented, opt-in / internal API | Indexes text-node links, file nodes and Canvas frontmatter for cache/resolved-link consumers. Obsidian upgrade testing required |
| Graph links / backlinks panel | Partial | Resolved-link cache and a guarded backlink-scan bridge are provided; the built-in Backlinks pane must be verified on desktop |
| Complex edge pathfinding / floating-side routing / custom arrow geometry | Not yet complete | Stored edge style hints do not replace a full custom edge renderer |
| Full Advanced JSON Canvas style-attribute compatibility | Partial | Common node/edge settings are stored, but the entire upstream format and all style renderers are not covered |
| True interactive Canvas portals | Not yet complete | Current command creates an embedded Canvas reference card; it does not mirror and edit another Canvas's nodes as a native portal |
| PDF page splitting / fixed page rendering | Implemented, basic | Pinned PDF pages are rendered into Canvas file nodes through Obsidian's PDF embed registry |
| Freehand PDF page annotations | Implemented, basic | Strokes persist in Canvas JSON; selection, resize, touch input and PDF page rotations require manual tests |
| Full PDF annotation tools (highlighter, text selection, multipage toolbar) | Not yet complete | Current overlay is a freehand layer, not a full PDF editor |
| Full metadata frontmatter editor / property UI for Canvas files | Not yet complete | Indexes available Canvas frontmatter; creating/editing all metadata properties in a dedicated UI remains |
| Alternative text renderer / all advanced export settings | Not yet complete | Needs further renderer-specific work |

## AI Canvas

| Feature | Status | Notes |
|---|---|---|
| Ask AI from a selected node | Implemented | Adds a progressively updated response node connected to the source |
| Stop in-flight generation | Implemented, transport-dependent | Uses AbortController for streaming fetch; a fallback non-streaming request may not be cancellable |
| Regenerate response | Implemented | Requires Better Canvas generation metadata on the response node |
| Per-node provider / model overrides | Implemented | Stores provider and model identifiers on the node |
| Multiple provider profiles | Implemented | Native OpenAI-compatible, Anthropic Messages and Gemini adapters; providers with unsupported APIs may need a compatible gateway |
| Connected image vision context | Implemented, basic | Sends up to four connected local image files under a size limit; remote images and PDFs are not fully handled |
| Image generation to Vault | Implemented, provider-dependent | OpenAI-compatible Images endpoint or compatible Gemini image model; not every gateway supports it |
| Related research questions / title generation / idea expansion | Implemented | Uses model-produced structured responses |
| Flashcard generation | Implemented | Can create flashcard nodes; does not directly create a spaced-repetition deck |
| Webpage text ingestion | Implemented, best-effort | JavaScript-only, login-gated and anti-bot pages may fail |
| YouTube caption ingestion | Implemented, best-effort | Requires accessible captions; videos without retrievable captions cannot be transcribed |
| MCP remote tools | Implemented, remote Streamable HTTP | Does not support stdio or SSE-only MCP servers; endpoint/tool arguments are user-configured |
| PDF page context for AI | Partial | PDF page node exists visually; AI context does not yet extract PDF text or pixels from it |
| Gemini-native video / YouTube context | Not yet complete | Current video workflow imports public captions instead of forwarding video context to Gemini |
| All upstream model/provider SDKs, rich model picker and automatic tool routing | Partial | Core profiles and manual MCP tool calls work; not every upstream provider feature is replicated |

## Build and verification

- GitHub Actions runs `npm install`, `npm run typecheck`, `npm test` and `npm run build` on pushes and pull requests to `main`.
- CI verifies TypeScript, helper tests and the production bundle.
- CI does not run Obsidian itself. Before releasing, manually test Canvas persistence, keyboard shortcuts, native menus, metadata/backlinks, PDF annotations, image export and real provider requests on the intended desktop/mobile versions.
