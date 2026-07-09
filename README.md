# Mid-Air Flick Input System

A system for entering **emoji / Japanese / English** via mid-air flick gestures.
Each modality is developed independently as a separate subsystem, then bundled into a single integrated app (`midair`).

> ⚠️ **This branch `demo-app` is a demo version.**
> It is a prototype for hands-on testing and tuning of the mid-air flick input mechanics: **fold-based Japanese/English input**, **language switching via hand rotation**, an **input test page**, and **Japanese/English UI toggle**.
> Fingering configurations and thresholds are **adjustable from the UI** — this is not a stable release.
> Demo details are documented in [`docs/fold_input_demo.md`](docs/fold_input_demo.md).

**Character recognition (hand detection → gesture/flick interpretation → character commit) runs entirely in the browser frontend (`index.html`).** The backend (CLIP embedding + FAISS nearest-neighbor search in `emoji-search`) is only needed for modalities that **recognize and search trajectories or text to find candidates** — like emoji. Flick-based kana input and language-switch motions that deterministically map gestures to characters are frontend-only, with no backend required (the same applies to English if using the same scheme).

## Subsystems

| Modality | Package | Status | Overview |
|---|---|---|---|
| Emoji input | `emoji-search` | **Implemented (v0)** | Embeds OpenMoji with CLIP; search by text / handwritten image / camera |
| Japanese input | Prototype in Web UI | **Fold-input demo** | Select row by folding fingers (binary fingering) + flick for vowel → confirm with open palm. Frontend-only. |
| English input | Prototype in Web UI | **Fold-input demo** | Select row (1–11) with the same fold engine + flick for letter. Frontend-only. |

> The Japanese/English "prototypes" refer to the Web UI implementation in the `demo-app` branch (no backend packages yet). See [`docs/fold_input_demo.md`](docs/fold_input_demo.md) and [`docs/japanese_input.md`](docs/japanese_input.md) for details.

The shared foundation `midair-shared` provides the **encoder contract / FAISS utilities / integration contract (`Searcher`)**.
The integrated app `midair-app` lazily loads and dispatches to each subsystem based on `mode`.
The browser UI is served by `midair-web` (FastAPI) — text / handwritten / camera mid-air input, results displayed as images, async search.

## Repository Structure (uv workspace monorepo)

```
mi-midair-input/
├── pyproject.toml              # uv workspace root (package=false, members=packages/*)
├── README.md / CLAUDE.md
├── Dockerfile / docker-compose.yml / .dockerignore
├── scripts/run-web.sh          # Docker launcher (auto-selects available port)
├── docs/                        # Documentation
│   └── emoji_search/            #   DOCKER.md / experiment plans, etc.
├── packages/
│   ├── shared/                 # midair-shared: shared foundation
│   │   └── src/midair_shared/
│   │       ├── encoder.py      #   TextEncoder / MultimodalEncoder contracts
│   │       ├── index.py        #   FAISS build / save / search
│   │       └── search.py       #   Searcher / SearchResult contracts (integration seam)
│   ├── emoji-search/           # Emoji input (implemented)
│   │   ├── scripts/           #   download_openmoji.py / build_index.py
│   │   └── src/emoji_search/   #   encoder.py / data.py / searcher.py
│   ├── app/                    # midair-app: integrated CLI (`midair`)
│   │   └── src/midair_app/     #   registry.py / __main__.py
│   └── web/                    # midair-web: Web app (FastAPI, async search)
│       ├── scripts/           #   fetch_mediapipe.py (fetches MediaPipe for camera input)
│       └── src/midair_web/     #   app.py / __main__.py / static/index.html
└── data/                       # Not tracked by git (.gitkeep only)
    ├── emoji_search/           #   openmoji/ + openmoji.json + index.faiss + metadata.jsonl
    └── english_search/
```

Data is isolated in per-subsystem directories and does not cross-contaminate.

---

# How to Run

**Recommended: Docker.** It isolates all dependencies (torch, transformers, faiss, MediaPipe) in a container, avoiding library conflicts with your local Python environment. Intel Mac runs natively; Apple Silicon runs via amd64 emulation.

The uv method is for contributors who need to modify Python code and want hot reload. It requires managing the workspace dependencies locally and may conflict with existing packages.

Three things are needed for emoji search (steps differ by method — see below):

- **OpenMoji images** — for displaying results (downloaded from official Releases)
- **Drive FAISS index** — for search. The pre-built index is shared via Drive to avoid running heavy CLIP inference on every machine.
- **MediaPipe (Hand Landmarker)** — only needed for camera mid-air input (hand gestures)

> If `data/emoji_search/` already has images and the index (e.g., copied from another machine), you can skip data prep and go straight to startup.

---

## A. Run with Docker (Recommended)

### A-1. Build the image

```bash
docker compose build
```

- Installs CPU-only torch / transformers / faiss and bakes **CLIP ViT-B/32** into the image (first build takes a few minutes including ~600 MB CLIP download).
- **MediaPipe JS / wasm / model files are also bundled at build time** (`Dockerfile` runs `fetch_mediapipe.py`) → camera mid-air input works **offline with no extra setup**.

### A-2. Prepare data (OpenMoji images + Drive FAISS index)

```bash
# Fetch display images (official) and index (Drive) in one command — no CLIP inference needed
docker compose --profile setup run --rm fetch
#   -> data/emoji_search/{openmoji/, openmoji.json, index.faiss, metadata.jsonl, index_meta.json}
```

- **OpenMoji and the Drive FAISS index are both fetched by this single command** (`fetch` service runs `download_openmoji.py` and `gdown`).
- **MediaPipe was already baked in at A-1 — no action needed here.**
- To use a different Drive folder: `MIDAIR_INDEX_URL="<other folder share link>" docker compose --profile setup run --rm fetch`
- ⚠️ `gdown --folder` extracts into `data/<Drive folder name>/`. It lands in `data/emoji_search/` only **if the shared folder is named `emoji_search`** (renaming drops it into a different directory).

To build the index locally from scratch (from line-art source, heavy CLIP inference):

```bash
docker compose --profile setup run --rm prepare
```

### A-3. Start (auto port assignment)

**Recommended: `scripts/run-web.sh`** — a wrapper that **picks an available port first, then calls `docker compose up`**, and prints the URL:

1. Scans for an open port starting at 8762 (shifts if taken — e.g., if 8762/8763 are busy, uses 8764)
2. Runs `docker compose up web` with `MIDAIR_WEB_PORT=<port>`
3. Prints `http://localhost:<port>`

```bash
scripts/run-web.sh               # Pick port, start, print URL
scripts/run-web.sh -d            # Background mode (extra args passed to compose)
```

To fix the port, use `docker compose` directly (**fails if 8762 is taken**, and does not print the URL):

```bash
# Default: host 8762 -> container 8000
docker compose up web            # Foreground  http://localhost:8762
docker compose up -d web         # Background
MIDAIR_WEB_PORT=9000 docker compose up web   # Manual port override
```

Stop:

```bash
docker compose down
```

### A-4. Using the app

- Open the URL shown (default http://localhost:8762) **in a browser**. Search via text input, handwritten canvas, or camera mid-air input; results appear as a grid of emoji images (search is an async job).
- **One-shot CLI**:
  ```bash
  docker compose run --rm web midair --mode emoji --query "cat" --top-k 5
  ```

See [`docs/emoji_search/DOCKER.md`](docs/emoji_search/DOCKER.md) for details.

---

## B. Run with uv (for contributors)

Use this only if you need to modify Python code. Requires [uv](https://docs.astral.sh/uv/).

### B-0. Setup

```bash
uv sync          # Install all workspace packages into a single shared venv
```

Verify:

```bash
uv run python -c "import torch, transformers, faiss; print('ok')"
```

### B-1. Download OpenMoji images (for display)

```bash
uv run python packages/emoji-search/scripts/download_openmoji.py
#   -> data/emoji_search/{openmoji/, openmoji.json}   (idempotent: skips existing, --force to re-fetch)
```

### B-2. Download FAISS index from Drive (for search)

```bash
uvx gdown --folder "https://drive.google.com/drive/folders/1ucgsVXXp6jOTWapOPTLsz9i-wpnPS652" -O data
#   -> data/emoji_search/{index.faiss, metadata.jsonl, index_meta.json}
```

- ⚠️ `gdown --folder` extracts into `data/<Drive folder name>/`. The above command places files in `data/emoji_search/` only **if the shared folder is named `emoji_search`**.
- Search assumes the **same CLIP model** as specified in `index_meta.json` (the index is device-independent and portable).

To build the index locally from scratch (from line-art source, heavy CLIP inference):

```bash
uv run python packages/emoji-search/scripts/download_openmoji.py --variant both
uv run python packages/emoji-search/scripts/build_index.py --source-variant black
```

### B-3. Download MediaPipe (only for camera mid-air input)

```bash
uv run python packages/web/scripts/fetch_mediapipe.py
#   -> packages/web/src/midair_web/static/vendor/mediapipe/ (idempotent, --force to re-fetch)
```

- Not needed if you only use text / handwritten input. **Only run this if you want camera input** (Docker handles this automatically at A-1).

### B-4. Using the app

Before starting, run the health check to confirm all dependencies, OpenMoji, FAISS index, MediaPipe, and web prerequisites are in place:

```bash
uv run midair-doctor
```

```bash
# Web app (auto port assignment built in)
uv run midair-web
#   Default http://127.0.0.1:8762. Automatically shifts to the next available port if 8762 is taken.
#   --port <start port> / --strict-port (no shifting) / --reload (dev auto-reload) / --host

# Integrated CLI
uv run midair --mode emoji --query "cat" --top-k 5
#   0.250  🐈‍⬛  1F408-200D-2B1B  black cat
#   0.246  🐈️  1F408            cat
#   ...
uv run midair --mode japanese --query "..."   # Not implemented (skeleton, exits 2)
uv run midair --mode english  --query "..."   # Not implemented (skeleton, exits 2)
```

See [`packages/emoji-search/README.md`](packages/emoji-search/README.md) and [`packages/web/README.md`](packages/web/README.md) for more.

---

## Troubleshooting

### `uv run ...` appears to hang during install

Check what's actually running:

```bash
ps -ef | grep -E 'uv run|build_index|fetch_mediapipe|download_openmoji'
```

If a `build_index.py` Python process is consuming CPU, it's building the index — not stuck on install. From step `[2/4]` onward, CLIP is computing locally; just wait.

### Hugging Face warnings appear

```text
Warning: You are sending unauthenticated requests to the HF Hub.
```

This warns that unauthenticated access may be slower or rate-limited — it does not mean failure. If index building is just slow, use the Drive index instead of building locally:

```bash
uvx gdown --folder "https://drive.google.com/drive/folders/1ucgsVXXp6jOTWapOPTLsz9i-wpnPS652" -O data
```

To verify model download separately:

```bash
uv run python -c "from transformers import CLIPModel, CLIPProcessor; m='openai/clip-vit-base-patch32'; CLIPModel.from_pretrained(m); CLIPProcessor.from_pretrained(m)"
```

### Camera error for `vision_bundle.mjs`

MediaPipe static files are missing, or the server wasn't restarted after fetching them.

```bash
uv run python packages/web/scripts/fetch_mediapipe.py
uv run midair-web
```

Then hard-reload the browser.

### Just want to check if all artifacts are present

```bash
uv run midair-doctor
```

---

## Documentation

- [`docs/fold_input_demo.md`](docs/fold_input_demo.md) — **`demo-app` branch demo contents** (fold-based Japanese/English input, language switching, input test, UI language toggle, tunable parameters)
- [`docs/japanese_input.md`](docs/japanese_input.md) — Japanese fold-input: fingering, parameters, internal spec
- [`docs/architecture.md`](docs/architecture.md) — Overall architecture / package scopes and boundaries / integration seam
- [`docs/emoji_search/DOCKER.md`](docs/emoji_search/DOCKER.md) — Local Docker execution (Mac / CPU)
- [`docs/emoji_search/experiment-domain-matched-index.md`](docs/emoji_search/experiment-domain-matched-index.md) — Experiment plan for building a domain-matched index for handwriting (instructions for another device)
- [`CLAUDE.md`](CLAUDE.md) — System architecture / development flow (git-flow) / agent guidelines
- `packages/*/README.md` — Per-subsystem details

## License

OpenMoji emoji data is licensed under **CC BY-SA 4.0** (attribution required when redistributing).
