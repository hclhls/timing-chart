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

## Docker

Production serves the built app at <http://localhost:8080>:

```bash
docker compose up --build
```

The API service accepts `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL` from the server environment (or a Compose `.env` file).
`AI_API_KEY` must remain server-side: never pass it through Vite/client variables such as `VITE_AI_API_KEY`.

For development with Vite, use <http://localhost:5173>:

```bash
docker compose -f compose.yaml -f compose.dev.yaml up --build
```

The optional local bridge is available on port `51123`:

```bash
docker compose -f compose.yaml -f compose.dev.yaml --profile dev up --build bridge
```

### Security notes for public or company-network deployments

The production Compose web port is bound to `127.0.0.1:8080` by default. To let other company devices use the app, do not expose the Docker port directly. Put an HTTPS reverse proxy such as Nginx in front of it and apply all of the following controls:

- Require company SSO, VPN access, or authentication at the reverse proxy
- Allow only the company network ranges; do not expose the service directly to the public Internet
- Never publish ports `51124` (AI API) or `51123` (bridge). Use the bridge only during development and keep it loopback-only
- Proxy requests from the reverse proxy to `127.0.0.1:8080`. The application Host/Origin checks reject unexpected values with `403`
- Keep AI API keys only in server-side `.env` files or a secret manager; never commit them to GitHub or expose them to the browser
- The chart, chat history, and requested changes are sent to the configured AI provider. Confirm that this complies with company data-protection rules and provider agreements
- Configure authentication, rate limiting, and sensitive-data masking in the reverse proxy as well

An unauthenticated Internet-facing deployment is not supported. The built-in concurrent AI request limit only reduces abuse; it is not a substitute for user authentication.

## AI Chat Setup

The optional chat panel uses an OpenAI-compatible service through the server-side Node proxy. In one terminal,
start the Vite client and the API proxy:

```bash
npm run dev        # browser app at http://localhost:5173/
npm run api        # server-side proxy at http://localhost:51124/
```

Configure the proxy process with these environment variables before `npm run api`:

- `AI_BASE_URL`: the provider base URL, such as `https://api.openai.com/v1`; the proxy calls its `/chat/completions` endpoint
- `AI_API_KEY`: the provider API key
- `AI_MODEL`: the model identifier supported by the provider

For example:

```bash
AI_BASE_URL=https://api.openai.com/v1 \
AI_API_KEY=your-key \
AI_MODEL=your-model \
npm run api
```

Keep `AI_API_KEY` server-side. **Never put it in Vite/client environment variables** (such as `VITE_AI_API_KEY`),
source code, or a deployed frontend, because client variables are exposed to browser users. The browser sends chat
requests only to the local proxy, which adds the key when contacting the OpenAI-compatible service.

In the chat panel, enter a requested chart change and choose **Generate proposal**. Review the assistant explanation,
warnings, temporary waveform preview, and optional technical WaveJSON diff; then choose **Apply proposal** or **Discard**.
Applying updates the editor (and its undo history), while discarding leaves the chart unchanged.

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
