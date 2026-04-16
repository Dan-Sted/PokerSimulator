# Poker Simulator

A full-stack Texas Hold'em poker simulator powered by AI agents using Retrieval-Augmented Generation (RAG) and large language models. Each AI player has a unique personality backed by real poker strategy literature.

## Features

- **5 AI Personalities** — Calculator, Shark, Gambler, Maniac, Rock — each with distinct playstyles sourced from poker books via RAG
- **3 AI Backends** — Ollama (local LLM), Gemini API, or Browser automation (Playwright)
- **Full Texas Hold'em** — Blinds, betting rounds, all-in/side pots, blind escalation, tournament mode
- **Human Player Mode** — Play alongside AI opponents with fold/call/raise controls
- **Animated UI** — Card dealing, chip fly animations, showdown flips, community card reveals
- **Stats Dashboard** — Per-player win rates, action frequency charts (fold/call/raise/check)
- **RAG Pipeline** — ChromaDB + LangChain + Google embeddings, per-personality vector collections
- **One-Command Startup** — `start.sh` installs dependencies and launches everything

## Quick Start

```bash
./start.sh
```

The script handles dependencies, starts Ollama, launches the backend and frontend, and opens the app in your browser.

See [Getting Started](getting-started.md) for manual setup and configuration details.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Tailwind CSS, Recharts |
| Backend | FastAPI, Python 3.11+ |
| AI | Ollama (local), Gemini 2.0 Flash (API), Playwright (browser) |
| RAG | ChromaDB, LangChain, Google Generative AI Embeddings |
| Hand Eval | Custom pure-Python deterministic evaluator |

## Project Structure

```
PokerSimulator/
├── backend/
│   ├── main.py          # FastAPI server, game logic, AI agents
│   ├── ingestBooks.py   # RAG ingestion pipeline
│   └── books/           # Source material per personality
├── frontend/
│   └── src/
│       ├── components/  # React components (PokerTable, etc.)
│       └── api.js       # Backend API calls
├── docs/                # This documentation site
└── start.sh             # One-command startup script
```
