# Poker Simulator

**AI-Powered Texas Hold'em** — a full-stack poker simulator where every seat is driven by a distinct AI personality backed by real poker literature through a RAG (Retrieval-Augmented Generation) pipeline.

---

## Features

### Gameplay
- Full Texas Hold'em rules — preflop, flop, turn, river, showdown
- 3–5 AI players with optional human seat
- Side pot computation for all-in scenarios
- Blind escalation every 3 rounds (tournament mode)
- Deterministic hand evaluation with correct kicker resolution
- Tournament play — last player standing wins

### AI Modes
| Mode | Description |
|------|-------------|
| **Ollama** | Runs a local model (e.g. `llama3.2`) — no internet required |
| **Gemini API** | Calls Google Gemini 2.5 Flash directly via API key |
| **Browser** | Automates the Gemini web UI via Playwright — bypasses rate limits |

### AI Personalities
Each personality has its own ChromaDB collection populated from real poker books:

| Name | Style |
|------|-------|
| **Calculator** | GTO-focused, mathematical (Sklansky) |
| **Shark** | Professional, reads opponents (Negreanu) |
| **Gambler** | Aggressive value-seeking (Rounder) |
| **Maniac** | Hyper-aggressive, unpredictable (Seidman) |
| **Rock** | Tight, conservative (Dummies) |

### UI & Animations
- Poker table with realistic oval felt and seat positions
- Card dealing animations — cards fly from dealer position to each seat
- Chip fly animation on raises
- Card flip reveal at showdown
- Staggered community card animations
- All-in indicator with pulsing purple ring
- Winner banner with tournament champion screen

### Game Controls
- **Pause / Resume** — freezes the game loop between AI turns; result is held and applied instantly on resume
- **Auto-Run** — automatically advances to the next round after a short delay
- **Game Speed** — Fast / Normal / Slow action delay
- **Show / Hide Hands** — reveal or hide all hole cards
- **Options dropdown** — in-game access to speed, auto-run, and hand visibility

### Stats & Analytics
- Career stats board persisted in `localStorage`:  Matches played, Rounds won, Tournaments won, Rounds per match
- Action frequency chart — per-player % breakdown of Fold / Call / Check / Raise

---

## Quick Start

```bash
./start.sh
```

This single command handles everything — see [Getting Started](docs/getting-started.md) for details.

---

## Documentation

| Doc | Description |
|-----|-------------|
| [Getting Started](docs/getting-started.md) | Installation, setup, and first run |
| [Architecture](docs/architecture.md) | System design and data flow |
| [API Reference](docs/api.md) | All backend endpoints |
| [Development Guide](docs/development.md) | Local dev tips and troubleshooting |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Vite, Tailwind CSS v4, Lucide React |
| Backend | FastAPI, Uvicorn, Python 3.10+ |
| Local AI | Ollama |
| Cloud AI | Google Gemini 2.5 Flash |
| Browser AI | Playwright (Chromium) |
| RAG | ChromaDB, LangChain, Google Embeddings |
| Hand Evaluation | Custom pure-Python 7-card evaluator |
