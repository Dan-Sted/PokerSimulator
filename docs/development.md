# Development Guide

Tips and conventions for local development on PokerSimulator.

## Running Locally

### Backend

```bash
cd backend
source venv/bin/activate   # or venv\Scripts\activate on Windows
uvicorn main:app --reload
```

`--reload` enables auto-restart on code changes.

### Frontend

```bash
cd frontend
npm run dev
```

Vite provides hot module replacement (HMR) for fast feedback.

## Data Format

### RAG input structure

Place poker knowledge in plain text files under:

```
backend/data/{pro_name}/*.txt
```

- `{pro_name}` — Identifier for the player persona (e.g. `daniel_negreanu`, `pro_aggressive`).
- Files — Any `.txt` files; content is chunked and embedded.

### Chunking

- **Chunk size:** 1000 characters
- **Overlap:** 100 characters (reduces context loss at boundaries)

To change this, edit `ingestBooks.py` and adjust `RecursiveCharacterTextSplitter` parameters.

## Updating RAG Data

When you add or modify `.txt` files:

1. Run `python ingestBooks.py` from `backend/`.
2. ChromaDB will create or overwrite collections for each pro.

ChromaDB persists to `backend/database/`. Delete this folder to reset all embeddings.

## Environment Variables

| Variable       | Purpose                          |
|----------------|----------------------------------|
| `GEMINI_API_KEY` | Gemini API for PokerAgent       |
| `GOOGLE_API_KEY` | Google AI for embeddings (RAG)  |

Create `backend/.env` and add these. Never commit `.env` to version control.

## Common Issues

### ChromaDB / SQLite on Windows

If ChromaDB fails with SQLite errors, install `pysqlite3-binary`:

```bash
pip install pysqlite3-binary
```

### Missing API keys

- Ensure `.env` exists in `backend/` and contains valid keys.
- `load_dotenv()` in `main.py` and `ingestBooks.py` loads from the current working directory.

### `ingestBooks.py` finds no documents

- Check that `backend/data/` exists.
- Ensure each pro has a subdirectory with at least one `.txt` file.
- Run the script from the `backend/` directory.

### Port already in use

- Backend: `uvicorn main:app --reload --port 8001`
- Frontend: edit `vite.config.js` or use `npm run dev -- --port 5174`

## Project TODO (from README)

- Handle Books and chunk generation
- Get Gemini API's set up for everyone
- Build out Frontend
- Build out Backend
- VectorDB integration in `/play-turn`

## Testing

- **Poker engine:** `python backend/pokerTest.py` — runs a small terminal game.
- **API:** Visit `http://127.0.0.1:8000/docs` and use Swagger UI to call endpoints.
