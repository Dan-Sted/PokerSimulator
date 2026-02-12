# Getting Started

This guide walks you through setting up PokerSimulator from scratch.

## Prerequisites

- **Python 3.10+**
- **Node.js 18+** and npm
- **Google Gemini API Key** — [Get one here](https://ai.google.dev/)
- **Google AI API Key** — For embeddings (RAG); often same as Gemini key

## Backend Setup

### 1. Create and activate virtual environment

```bash
cd backend
python -m venv venv
```

**Linux / macOS:**
```bash
source venv/bin/activate
```

**Windows (PowerShell):**
```powershell
.\venv\Scripts\Activate.ps1
```

**Windows (CMD):**
```cmd
venv\Scripts\activate.bat
```

### 2. Install dependencies

```bash
pip install fastapi uvicorn python-dotenv google-genai
pip install langchain langchain-community langchain-google-genai langchain-text-splitters
pip install PyPokerEngine
```

> **Note:** `pysqlite3-binary` is recommended on Windows for ChromaDB compatibility with the SQLite backend.

### 3. Environment variables

Create a `.env` file in the `backend/` directory:

```env
GEMINI_API_KEY=your_gemini_api_key_here
GOOGLE_API_KEY=your_google_api_key_here
```

Both keys are typically available from [Google AI Studio](https://aistudio.google.com/). If you only have one key, try using it for both variables.

### 4. Run the backend

```bash
uvicorn main:app --reload
```

The API will be available at `http://127.0.0.1:8000`. Visit `http://127.0.0.1:8000/docs` for interactive API documentation.

## Frontend Setup

### 1. Install dependencies

```bash
cd frontend
npm install
```

### 2. Run the development server

```bash
npm run dev
```

The frontend will be available at the URL shown in the terminal (typically `http://localhost:xxxx`).

## Ingesting Poker Knowledge (RAG)

Before AI agents can use book knowledge, you need to ingest text files into ChromaDB.

### 1. Prepare data directory

Create a `data` folder in `backend/` and add subdirectories for each "pro" (player persona):

```
backend/
├── data/
│   ├── pro_player_1/
│   │   ├── book1.txt
│   │   └── notes.txt
│   └── pro_player_2/
│       └── strategy.txt
```

Each `.txt` file should contain poker strategy, concepts, or notes in plain text.

### 2. Run ingestion

From the `backend/` directory:

```bash
python ingestBooks.py
```

This will:
- Load all `.txt` files from each pro's folder
- Chunk them (1000 chars, 100 char overlap)
- Embed with Google's embedding model
- Store in ChromaDB under `./database/` with collections like `pro_pro_player_1`, `pro_pro_player_2`

## Running a Test Game

To run a simple poker game in the terminal (2 bots + 1 human, 5 rounds):

```bash
cd backend
python pokerTest.py
```

Use the console to input actions: `fold`, `call`, or `raise` (with amount when raising).

## Verify Installation

1. **Backend:** `curl http://127.0.0.1:8000/` should return `{"message":"Poker Backend Running"}`
2. **Frontend:** Open the dev server URL in a browser and confirm the app loads
3. **RAG:** After ingestion, `backend/database/` should exist with ChromaDB data

## Next Steps

- Read [Architecture](architecture.md) to understand how components fit together
- See [API Reference](api.md) for endpoint details
- Check [Development Guide](development.md) for local development tips
