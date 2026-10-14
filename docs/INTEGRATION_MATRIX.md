# Integration feature matrix

This matrix distinguishes code included in Better Canvas from features that still require a dedicated migration or runtime verification. "Implemented" means an implementation exists in this repository; it does not imply compatibility with every Obsidian release or every API gateway.

## Canvas MindMap

| Feature | Status | Notes |
|---|---|---|
| Create child node | Implemented | Tab / command palette |
| Create sibling node | Implemented | Enter / command palette; requires a parent edge |
| Create floating node | Implemented | Command palette and Ctrl/Cmd + arrow |
| Create directional child node | Implemented | Ctrl/Cmd + Shift + arrow |
| AI-generated mind map | Implemented, basic | Builds connected nodes from a structured AI JSON response; malformed references are skipped |
| AI-generated standalone flashcards | Implemented | Builds one question/answer node per card; output schema depends on the configured model |
| Navigate adjacent nodes | Implemented | Alt + arrow |
| Tree selection | Implemented | Command selects descendants of a selected root |
| LR / RL / TB / BT tree layout | Implemented | Current layout algorithm handles cycles by avoiding repeated nodes |
| Convert Markdown H1 headings to nodes | Implemented | Command operates on a selected Markdown file node |
| Per-edge color | Implemented | Better Canvas metadata is rendered by the plugin |
| Branch-specific tree layout for complex multi-parent graphs | Partial | Layout is optimized for tree-like directed graphs, not arbitrary directed graphs |

## Advanced Canvas

| Feature | Status | Notes |
|---|---|---|
| Canvas search | Implemented | Searches node text, file paths, URLs, and node types |
| Node templates | Implemented | Save and insert reusable text-node templates |
| Presentation mode | Implemented, basic | Slides use spatial order; graph-defined sequencing and readonly canvas mode are not yet migrated |
| Node shapes | Partial | Default, pill, diamond, parallelogram and hexagon render through plugin CSS |
| Node color / custom palette | Implemented | Additional CSS color slots and per-node border color |
| Border styles / text alignment | Partial | Solid, dashed, dotted, double; no full style-attribute schema editor yet |
| Edge color / line style | Partial | Color and solid/dashed/dotted lines; custom arrow heads are not yet implemented |
| Flip edge direction | Implemented | Flips all edges incident to the selected node |
| Bring node front / send node back | Implemented | Based on Canvas data node order; exact renderer stacking order can vary by Obsidian release |
| Focus mode / edge emphasis | Implemented, basic | Dims unrelated nodes and edges |
| Auto-resize text nodes | Implemented, opt-in | Enable per node from command palette; UI/DOM observer requires desktop verification |
| Group collapse / expand | Partial | Stores hidden nodes and edges as extension data; nested groups and clipboard round-trip need more testing |
| Encapsulate selection into another canvas | Implemented | Creates a new .canvas and replaces selected nodes with a file node |
| Export JSON Canvas | Implemented | Saves a separate Canvas JSON file in the vault |
| Export PNG / SVG | Implemented, basic | Uses html-to-image against the Canvas DOM; embeds/fonts/very large boards may need testing |
| Copy a node Wikilink and render a node embed | Partial | Supports [[canvas.canvas#node-id]] and its embed form in Markdown post-processing |
| Auto edges from file frontmatter | Implemented, basic | Reads a configurable key, default canvas-edges, from file-node Markdown frontmatter |
| Frontmatter metadata cache/backlinks for .canvas | Not yet migrated | Needs a dedicated Obsidian metadata/file-manager patch with version-specific safeguards |
| Complex edge pathfinding / floating sides / arrow-head styles | Not yet migrated | Requires custom edge geometry and Canvas internal renderer patches |
| Variable zoom breakpoints / alternative text renderer | Not yet migrated | Requires a custom Canvas renderer patch |
| Better readonly / canvas panning and zoom locks | Not yet migrated | Needs readonly-mode integration with native Canvas controls |
| Full collapsible-group UI semantics | Partial | Core data logic exists; rendering, nested groups and selection/copy semantics need runtime testing |
| PDF page splitting | Partial | Creates pinned page-subpath nodes; this is not the full per-page PDF annotation workflow |
| PDF page pinning / annotation overlay | Not yet migrated | Requires page embed view integration and PDF annotation UI |
| True Canvas portals (interactive canvas inside canvas) | Not yet migrated | Requires embedded CanvasView lifecycle and edge mapping |

## AI Canvas

| Feature | Status | Notes |
|---|---|---|
| Ask AI from a selected node | Implemented | Adds a new response node linked to its source |
| Regenerate AI response | Implemented | Requires retained Better Canvas generation metadata |
| Stop streaming generation | Implemented when streaming transport is available | A compatibility fallback may perform a non-streaming request when the runtime blocks streaming fetch |
| Live response node updates | Implemented | Progressive updates use the Canvas node API when available |
| Per-node provider/model overrides | Implemented | Profile settings use OpenAI-compatible Chat Completions / Images endpoints |
| Multiple provider profiles | Implemented | OpenAI-compatible endpoints plus native Anthropic Messages and Gemini generateContent adapters; not every upstream provider is supported natively |
| Connected-image vision context | Implemented, basic | Sends up to four nearby image files under size limits through OpenAI-compatible multimodal message content |
| Image generation to Vault | Implemented, API-dependent | OpenAI-compatible /images/generations or a Gemini image-generation model; Anthropic native image generation is unsupported |
| Flashcard generation | Implemented | Generates cards as an AI response node; does not directly create a spaced-repetition deck file |
| Webpage text ingestion | Implemented, best-effort | JavaScript-only, login-gated, and anti-bot pages may fail |
| YouTube caption ingestion | Implemented, best-effort | Tries public timedtext captions; videos without retrievable captions cannot be transcribed |
| MCP tools | Implemented, remote Streamable HTTP | Does not support stdio or SSE-only MCP transports; tool calls require user-provided endpoint and arguments |
| Per-card AI model choice | Implemented | Model can be overridden for individual nodes |
| Native Gemini / Anthropic streaming | Implemented, best-effort | Uses the provider SSE endpoints; if fetch/CORS blocks streaming, adapter falls back to a non-streaming request |\n| Gemini-native YouTube video context | Not yet migrated | Current YouTube ingestion uses public captions rather than native Gemini video context |
| PDF document context, full multimodal provider routing, and rich model picker | Partial | Local Markdown and connected images are supported; full upstream provider/model functionality needs more adapters |
| Cancel in-flight request on plugin unload | Implemented | Active fetch requests are aborted during plugin cleanup; a fallback non-streaming request may not abort at the transport layer |

## Build and verification

- GitHub Actions runs npm install, npm run typecheck, and npm run build on pushes and pull requests to main.
- The current build uses TypeScript checks and a production esbuild bundle.
- Browser/editor interaction is not fully covered by this CI job. A release candidate still needs manual testing in the intended Obsidian desktop/mobile versions, particularly Canvas DOM/renderer patches, embeds, exports, PDF subpaths, and provider endpoints.
