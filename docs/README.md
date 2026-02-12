# PokerSimulator

Leveraging RAG (Retrieval-Augmented Generation) and LLMs to simulate poker with AI agents trained on professional poker knowledge.

## Overview

PokerSimulator combines:
- **RAG** — Vector-stored knowledge from poker books/notes, retrieved at decision time
- **LLM** — Gemini 2.0 Flash for fast, context-aware move generation
- **PyPokerEngine** — Rules, game flow, and hand evaluation

AI players make decisions based on retrieved book excerpts and the current game state.

## Quick Start

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install fastapi uvicorn python-dotenv google-genai langchain langchain-community langchain-google-genai langchain-text-splitters chromadb pysqlite3-binary PyPokerEngine
uvicorn main:app --reload

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
To Be Continued....
```

See [docs/getting-started.md](docs/getting-started.md) for detailed setup.

## Project Structure

```
PokerSimulator/
├── backend/           # FastAPI, RAG, LLM agents
│   ├── main.py        # API server + PokerAgent
│   ├── ingestBooks.py # RAG: ingest books into ChromaDB
│   └── pokerTest.py   # PyPokerEngine test game
├── frontend/          # React + Vite + Tailwind
└── docs/              # Documentation
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Google Gemini API key (backend, PokerAgent) |
| `GOOGLE_API_KEY` | Yes (for RAG) | Google AI API key (ingestBooks, embeddings) |

## TODO

- Handle Books and chunk generation: Dan
- Get Gemini API's set up for everyone
- Build out Frontend: JC and Alex
- Build out Backend
- VectorDB: Srihari and Dylan
- Build out and preserve docs: Jacob
