# Getting Started

This guide walks you through running PokerSimulator from scratch.

---

## The Fast Way — One Command

```bash
./start.sh
```

Run this from the project root. It will:

1. Install Node dependencies if `node_modules` is missing
2. Create a Python virtual environment if one doesn't exist
3. Install all Python dependencies from `requirements.txt`
4. Install Playwright's Chromium browser binary if needed
5. Start Ollama and pull the configured model if not already present
6. Start the FastAPI backend on port 8000
7. Start the Vite frontend on port 5173
8. Open your browser automatically

Press **Ctrl+C** to stop all processes cleanly.

Logs are written to `/tmp/poker-backend.log` and `/tmp/poker-frontend.log`.

---

## Manual Setup

If you prefer to run services individually:

### Prerequisites

- **Python 3.10+**
- **Node.js 18+** and npm
- **Ollama** — [ollama.com](https://ollama.com) (for local AI mode)
- **Google Gemini API Key** — [aistudio.google.com](https://aistudio.google.com) (for API mode)

---

### Backend

#### 1. Create and activate a virtual environment

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # macOS / Linux
# .\venv\Scripts\Activate.ps1  # Windows PowerShell
```

#### 2. Install dependencies

```bash
pip install -r requirements.txt
```

#### 3. Install Playwright browsers (required for Browser AI mode)

```bash
playwright install chromium
```

#### 4. Configure environment variables

The `.env` file in `backend/` controls AI mode configuration:

```env
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
GEMINI_API_KEY=your_key_here    # Optional — can also be set from the UI
```

- `OLLAMA_URL` / `OLLAMA_MODEL` — only needed for Ollama mode
- `GEMINI_API_KEY` — only needed for API mode. Can be entered from the Settings page in the UI instead of hardcoding here.

#### 5. Start the backend

```bash
uvicorn main:app --reload
```

Backend runs at `http://localhost:8000`. Visit `/docs` for the Swagger UI.

---

### Frontend

#### 1. Install dependencies

```bash
cd frontend
npm install
```

#### 2. Start the dev server

```bash
npm run dev
```

Frontend runs at `http://localhost:5173`.

---

### Ollama (Local AI Mode)

```bash
# Start the Ollama server
ollama serve

# Pull the model (first time only)
ollama pull llama3.2
```

---

## Configuring the Gemini API Key in the UI

If you prefer not to put your API key in `.env`, you can enter it directly in the app:

1. On the Settings page, set **AI Mode** to **API**
2. A **Gemini API Key** section appears in the right column
3. Paste your key and click **Save** — it's written to `.env` and loaded immediately

---

## Ingesting Poker Knowledge (RAG)

The AI personalities are backed by real poker books embedded into ChromaDB. The database is already pre-built and committed. If you ever need to rebuild it:

```bash
cd backend
python ingestBooks.py
```

This loads `.txt` files from `backend/books/`, chunks them, embeds with Google's embedding model, and stores them under `backend/database/`.

Each personality maps to a ChromaDB collection:

| Personality | Collection | Source |
|-------------|------------|--------|
| Calculator | `sklansky` | Theory of Poker |
| Shark | `negreanu` | Hold'em Wisdom |
| Gambler | `rounder` | Rounders strategy |
| Maniac | `seidman` | Aggressive play |
| Rock | `dummies` | Poker for Dummies |

---

## Verifying the Setup

```bash
# Backend health check
curl http://localhost:8000/
# → {"message":"Poker Backend Running"}

# Check browser is initialized (after clicking Initialize in-app)
curl http://localhost:8000/browser/status
# → {"ready": true}
```

---

## Next Steps

- [Architecture](architecture.md) — how the components fit together
- [API Reference](api.md) — all backend endpoints
- [Development Guide](development.md) — troubleshooting and local dev tips
