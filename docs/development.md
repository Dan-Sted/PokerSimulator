# Development Guide

Tips and conventions for local development on PokerSimulator.

---

## Running Locally

The fastest way is:

```bash
./start.sh
```

See [Getting Started](getting-started.md) for manual setup instructions.

---

## Project Structure Quick Reference

```
backend/
  main.py                  ← FastAPI app + hand evaluator + key management
  agents.py                ← PokerAgent (ollama / api / browser dispatch)
  gemini_browser.py        ← Playwright browser automation
  ingestBooks.py           ← RAG ingestion (run once, or after adding books)
  llm/
    ollama_client.py       ← Ollama HTTP client
    personality_prompts/   ← System prompts for each AI personality

frontend/src/
  components/PokerTable.jsx  ← Entire game UI, game loop, state, animations
  api.js                     ← All backend API calls (Axios)
  index.css                  ← Global styles, button hover rules
```

---

## Environment Variables

All backend config lives in `backend/.env`:

```env
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
GEMINI_API_KEY=your_key_here    # Can also be set from the Settings UI
```

**Never commit `.env` to version control.** The Gemini API key can be set at runtime from the Settings page and will be written to `.env` automatically.

---

## Adding or Updating Poker Knowledge (RAG)

1. Add `.txt` files to `backend/books/` under the relevant personality folder
2. Re-run ingestion from the backend directory:

```bash
cd backend
source venv/bin/activate
python ingestBooks.py
```

ChromaDB stores data in `backend/database/`. Delete this folder to fully reset all embeddings.

**Personality → collection mapping:**

| Personality | Collection |
|-------------|------------|
| Calculator | `sklansky` |
| Shark | `negreanu` |
| Gambler | `rounder` |
| Maniac | `seidman` |
| Rock | `dummies` |

---

## Adding a New AI Personality

1. Add a system prompt file to `backend/llm/personality_prompts/`
2. Add an entry to `PLAYERS` in `backend/main.py`:
   ```python
   "NewPlayer": ("collection_name", "new_player_prompt.txt"),
   ```
3. Add the name to `PLAYER_NAMES` in `frontend/src/components/PokerTable.jsx`:
   ```js
   const PLAYER_NAMES = ['Calculator', 'Shark', 'Gambler', 'Maniac', 'Rock', 'NewPlayer'];
   ```
4. Ingest books for the new collection

---

## Frontend Architecture Notes

All game logic and UI live in a single component: `PokerTable.jsx`. Key sections:

- **Sub-components** (top of file): `Card`, `Seat`, `HumanActionPanel`, `ChipFly`, `PokerChipSVG`, `SettingsScreen`
- **Constants**: `SEAT_POSITIONS`, `SEAT_CHIP_OFFSETS` — control where seats and chip animations appear for each player count
- **Game loop**: `runGameRound` → `runStreet` — async functions using React state setters and `useRef` for stop/pause signals
- **Pause mechanism**: `pauseRef` is checked after each `playTurn` response; `waitIfPaused()` polls every 100ms until cleared
- **Stats**: `playerStats` state is persisted to `localStorage` under `pk_player_stats`

---

## Common Issues

### `No module named 'playwright'`

```bash
pip install playwright
playwright install chromium
```

### Browser mode shows "thinking…" forever

The browser tab may have lost its session. Click **Clear** in the Gemini Account section and sign in again, then re-initialize.

### ChromaDB errors on Windows

```bash
pip install pysqlite3-binary
```

### Ollama not found

Make sure Ollama is installed and `ollama serve` is running before starting the backend, or use `./start.sh` which handles this automatically.

### Port already in use

```bash
# Backend on a different port
uvicorn main:app --reload --port 8001

# Frontend on a different port
npm run dev -- --port 5174
```

Update `vite.config.js` proxy target if you change the backend port.

### Gemini API key rejected (400 error)

Keys must start with `AIza`. Get one from [aistudio.google.com](https://aistudio.google.com).

### `ingestBooks.py` finds no documents

- Ensure `backend/books/` exists and contains subdirectories with `.txt` files
- Run the script from the `backend/` directory, not the project root

---

## Logs

When using `./start.sh`, service logs are written to:

```
/tmp/poker-backend.log
/tmp/poker-frontend.log
/tmp/ollama.log
```

Tail them during development:

```bash
tail -f /tmp/poker-backend.log
```
