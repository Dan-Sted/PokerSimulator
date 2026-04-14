# Architecture

This document describes the system design and data flow of PokerSimulator.

---

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (React)                          │
│                                                                 │
│   PokerTable.jsx   ──── api.js ────►  /play-turn               │
│   (Game UI, state,                    /evaluate-hands           │
│    animations,                        /browser/*               │
│    stats)                             /settings/*              │
└─────────────────────────────────────────────────────────────────┘
                              │
                     FastAPI (port 8000)
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
    Ollama (local)     Gemini API          Playwright
    llama3.2           gemini-2.5-flash    (Browser tabs)
          │                   │                   │
          └───────────────────┴───────────────────┘
                              │
                     PokerAgent + RAG
                              │
                         ChromaDB
                    (personality collections)
```

---

## System Components

### Frontend — `frontend/src/`

| File | Role |
|------|------|
| `components/PokerTable.jsx` | Entire game UI — table, seats, cards, animations, game loop, stats |
| `api.js` | Axios wrapper for all backend calls |
| `index.css` | Global styles and button hover effects |

**Key state managed in `PokerTable.jsx`:**
- Game phase (`settings` / `game`)
- Round state: stacks, pot, community cards, hole cards, street
- Player state: folded, all-in, active, eliminated
- Animation triggers: `dealKey`, `chipFlies`, `showdownRevealCards`
- Persistent stats: `playerStats` (localStorage)
- Controls: `autoContinue`, `actionSpeed`, `showHands`, `paused`

**Game loop flow:**

```
handleRunGame()
  └─► runGameRound(stacks, dealerIdx, roundNumber)
        ├─ Post blinds
        ├─ Deal hole cards  ──► setDealKey (triggers CSS animation)
        ├─ Wait for deal animation
        ├─ runStreet(preflop)
        │    └─ for each player:
        │         ├─ AI: playTurn() → hold result if paused → apply
        │         └─ Human: wait for UI action
        ├─ runStreet(flop / turn / river)
        ├─ Showdown: evaluateHands() → computeSidePots()
        └─ finish() / award side pots → setRoundComplete(true)
```

---

### Backend — `backend/`

| File | Role |
|------|------|
| `main.py` | FastAPI app, all routes, hand evaluator, Gemini key management |
| `agents.py` | `PokerAgent` class — wraps all three AI modes |
| `gemini_browser.py` | Playwright browser automation for Gemini web UI |
| `ingestBooks.py` | One-time RAG ingestion into ChromaDB |
| `llm/ollama_client.py` | Ollama HTTP client |
| `llm/personality_prompts/` | System prompts for each AI personality |

---

### AI Modes

#### Ollama (local)
- Sends system prompt + game state to a local Ollama model
- No internet required; speed depends on hardware
- Configured via `OLLAMA_URL` and `OLLAMA_MODEL` in `.env`

#### Gemini API
- Calls `gemini-2.5-flash` via `google-genai` SDK
- Multi-turn chat: system prompt sent first, then game state
- API key configured in `.env` or via Settings UI

#### Browser (Playwright)
- Opens one Chromium tab per AI player
- Each tab navigates to `gemini.google.com/app` and maintains its own chat session
- Bypasses API rate limits; requires a signed-in Google account
- Session state saved to `backend/browser_session/` for reuse

---

### RAG Pipeline

**Ingestion (`ingestBooks.py`):**
1. Load `.txt` files from `backend/books/`
2. Split with `RecursiveCharacterTextSplitter` (1000 chars, 100 overlap)
3. Embed with `GoogleGenerativeAIEmbeddings` (embedding-001)
4. Store in ChromaDB under `backend/database/`

**Retrieval (per turn in `main.py`):**
1. Format the current game state as a text query
2. Query the player's ChromaDB collection for top-3 relevant chunks
3. Inject snippets into the prompt as "Reference Material"
4. LLM responds with JSON: `{"action": "fold|call|raise", "amount": N, "reasoning": "..."}`

---

### Hand Evaluator

A custom pure-Python 7-card evaluator replaces PyPokerEngine's Monte Carlo estimator (which could not reliably break ties within the same hand rank).

**Algorithm:**
1. Generate all C(7,5) = 21 five-card combinations from hole + community cards
2. For each combination, compute a comparable rank tuple: `(category, tiebreaker1, ...)`
3. Return the maximum tuple — Python tuple comparison resolves all tiebreakers correctly

**Hand category values:**

| Value | Hand |
|-------|------|
| 8 | Straight Flush |
| 7 | Four of a Kind |
| 6 | Full House |
| 5 | Flush |
| 4 | Straight |
| 3 | Three of a Kind |
| 2 | Two Pair |
| 1 | One Pair |
| 0 | High Card |

---

## Directory Layout

```
PokerSimulator-enhancements/
├── start.sh                        # One-command startup script
├── README.md
├── backend/
│   ├── main.py                     # FastAPI app, routes, hand evaluator
│   ├── agents.py                   # PokerAgent (ollama / api / browser)
│   ├── gemini_browser.py           # Playwright automation
│   ├── ingestBooks.py              # RAG ingestion
│   ├── pokerTest.py                # Terminal-based test game
│   ├── requirements.txt
│   ├── .env                        # API keys and model config
│   ├── llm/
│   │   ├── ollama_client.py
│   │   ├── gemini.py
│   │   └── personality_prompts/
│   │       ├── calculator_prompt.txt
│   │       ├── shark_prompt.txt
│   │       ├── gambler_prompt.txt
│   │       ├── maniac_prompt.txt
│   │       └── rock_prompt.txt
│   ├── books/                      # Source poker literature (.txt)
│   ├── database/                   # ChromaDB persistence (auto-created)
│   └── browser_session/            # Playwright session cookies
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   └── PokerTable.jsx      # Entire game UI and logic
│   │   ├── api.js                  # API client
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   ├── package.json
│   └── vite.config.js
└── docs/
    ├── getting-started.md
    ├── architecture.md
    ├── api.md
    └── development.md
```

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Vite 7, Tailwind CSS v4, Axios, Lucide React |
| Backend | FastAPI, Uvicorn, Python 3.10+ |
| Local AI | Ollama |
| Cloud AI | Google Gemini 2.5 Flash (`google-genai` SDK) |
| Browser AI | Playwright (Chromium) |
| Vector DB | ChromaDB (persistent) |
| Embeddings | Google `embedding-001` via LangChain |
| RAG | LangChain (`langchain-community`, `langchain-google-genai`) |
| Hand Eval | Custom pure-Python evaluator (`itertools.combinations`) |
