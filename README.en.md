# Timing Chart Editor

[Japanese](README.md)

A browser-based editor for drawing **timing charts and waveform diagrams** for FPGA and embedded development.
It supports clocks, data and control signals, rising and falling edges, High / Low / X / Z states, multi-bit buses,
setup/hold annotations, SVG/PNG/JSON/SPICE-PWL export, and shareable links.

**Live: <https://kakuteki.github.io/timing-chart/>** (mobile friendly)

- **Fully client-side**: no server or database; all processing happens in the browser
- Rendering engine: [WaveDrom](https://github.com/wavedrom/wavedrom)
- **Hybrid editing**: GUI table and WaveJSON text stay synchronized
- Distributed via GitHub Pages

## Usage: Editing

- **GUI grid**: Select what to place with the state picker at the top, then click or drag cells to draw
  - The default **High/Low toggle** mode toggles `0` and `1` on click
  - Select **High (on) / Low (off) / Clock / Bus (value) / Extend** to paint that state
  - Use **More** for `x` (unknown), `z` (Hi-Z), arrow clocks (`P/N`), bus codes `2`-`9`, gaps (`|`), and **Cycle** mode, which advances `0->1->p->n->P->N->x->z->=` on click and reverses with `Shift+click`
  - Use **Extend** or `Alt+click` to extend the previous cell (`.`). Drag horizontally to paint consecutive cells
- **Bus values**: Edit labels such as `data[]` for `=` cells in the Bus Values panel
- **Annotations**: Select a signal and tick, add markers, then connect markers with arrows for setup/hold and similar notes
- **WaveJSON text**: Direct editing is supported. While JSON is invalid, the previous diagram is kept and an error is shown. JSON5 syntax such as trailing commas is accepted
- **Clock generation / + Signal / + Tick** are available from the toolbar and the top of the signal editor
- **Duplicate signal**: Select a signal and use **Duplicate** in the toolbar to copy it below the original
- **Period and phase for divided clocks**: Configure `period` and `phase` in the Period/Phase panel to create clocks such as clk/2. Grid editing is exact when `period=1`; for `period!=1`, the app warns and guides you to the code tab
- **Title and time axis**: Set the diagram title, footer note, and cycle numbering with the Title/Time Axis panel. These are reflected in exports
- **Mobile**: Row actions are grouped under `...`, and the grid scrolls both vertically and horizontally. Enable swipe painting to draw continuously with touch
- Keyboard operation is supported: arrow keys to move, Enter/Space to apply, and Alt+Enter to extend

## Export and Sharing

- **SVG / PNG (1x/2x/4x with transparent background option) / JSON / SPICE-PWL save** from the toolbar
- **Copy image** copies PNG to the clipboard for pasting into slides or documents
- **Load JSON** reads `.wavejson` and `.json` files
- **Share links** compress the model into the URL hash (`#d=...`). Opening the link restores the diagram. Oversized or excessive shared data is rejected safely

## Development

```bash
npm install
npm run dev        # http://localhost:5173/ (uses BASE_PATH=/ internally)
npm run build      # type check + production build to dist/
npm run preview
npm test           # integration/unit tests for bridge, WaveDrom rendering, wave-codec, GUI actions, envelope/share
```

> Tests use `node --test`. The `pretest` step bundles `src/model` and `src/state` with esbuild,
> so the TypeScript core logic, including lossless wave-codec behavior and GUI conversion actions, is verified in CI.

## Claude Code Integration: Bridge / HTTP Endpoint

External tools such as Claude Code can read and write the chart currently open in the browser.
The dependency-free local HTTP server at `bridge/server.mjs` brokers the model and synchronizes bidirectionally
with the browser via SSE and POST. It is loosely coupled and does not block the main app.

```bash
npm run build      # build first; the bridge also serves dist/
npm run bridge     # starts at http://localhost:51123
```

- Open `http://localhost:51123/timing-chart/` in the browser. You can also use the local `npm run dev` URL or the public site
- Press **Bridge connect** in the toolbar. The status dot turns green when connected
- Edits from Claude Code and browser edits now stay synchronized

### API with CORS

| Method | Path | Description |
|---|---|---|
| GET | `/health` | `{ ok, clients, rev }` |
| GET | `/model` | Get the current WaveJSON |
| POST | `/model` | Set WaveJSON. Requires a `signal` array; invalid input returns 400. Broadcasts to all clients |
| GET | `/events` | SSE. Sends the current value on connect, then pushes each change |

### Example Edits from Claude Code

```bash
# Get the current model
curl -s http://localhost:51123/model | jq .

# Replace the model; the browser updates immediately
curl -s -X POST http://localhost:51123/model \
  -H 'Content-Type: application/json' \
  -d '{"signal":[{"name":"clk","wave":"P.P.P."},{"name":"d","wave":"x=.=.x","data":["A","B"]}]}'
```

The port can be changed with the `BRIDGE_PORT` environment variable. The default is 51123.
Connections from the public HTTPS site to `http://localhost` work in Chrome, Edge, and Firefox, but Safari blocks them.
For the most reliable setup, run locally and open the URL served by `npm run bridge`.

#### Security

- Listens on **127.0.0.1 only**, not on the LAN
- **CSRF/DNS rebinding protection**: state-changing requests are accepted only from allowed Origins (localhost / this Pages site) and loopback Hosts. `curl` without an Origin continues to work
- Invalid or huge input is rejected with 4xx responses: 5 MB limit, type validation, and safe handling for invalid paths or invalid percent-encoding
- SSE connection limits and socket timeouts reduce local DoS risk
- The browser app also implements CSP (`script-src 'self'`, etc.) plus size and signal-count limits for share links

> The bridge is an unauthenticated local development tool intended for reading and writing from the same machine.

## Deploying to GitHub Pages

1. Use the ASCII repository name **`timing-chart`**. Non-ASCII names break asset URLs.
   If you use another name, update `base` in `vite.config.ts` to `'/<repo>/'`.
2. Pushing to the `main` branch runs `.github/workflows/deploy.yml`, which builds and publishes to Pages with `actions/deploy-pages`.
3. In repository **Settings -> Pages**, select **Source = GitHub Actions**.
4. Public URL: `https://<user>.github.io/timing-chart/`

## Tech Stack

- React + Vite + TypeScript / Zustand for state management
- `src/model`: WaveJSON types, lossless wave-string expand/compress, clock generation, parse(JSON5), and serialize
- `src/render`: WaveDromRenderer using `renderWaveElement` with explicit skin passing
- `src/state`: store as the single source of truth, GUI conversion actions, and selectors
- `src/components`: toolbar, GUI table, bus and annotation panels, text editor, and preview
- `src/export`: SVG serialization, PNG rasterization, and download handling
- `src/share`: URL sharing with lz-string

## License

[MIT License](LICENSE). The rendering engine [WaveDrom](https://github.com/wavedrom/wavedrom) is also MIT licensed.
