import os
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from backend.llm.ollama_client import generate as ollama_generate, OllamaError
import json

load_dotenv()

# Ollama uses a local server; ensure OLLAMA_URL / OLLAMA_MODEL in .env for custom settings.

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PlayTurnRequest(BaseModel):
    player_name: str
    state: dict

class PokerAgent:
    def __init__(self, name, book_path):
        self.name = name
        self.model = os.getenv("OLLAMA_MODEL")
        self.instruction = f"You are {name}, a professional poker player. Use the provided context from your books to make decisions. Respond only with a single JSON object describing your chosen action."

    async def get_move(self, game_state, context_snippets):
        prompt = f"""
        CONTEXT FROM YOUR BOOKS:
        {context_snippets}

        GAME STATE:
        {game_state}

        What is your move? Respond in JSON: {{"action": "CALL|FOLD|RAISE", "amount": 0, "reasoning": "..."}}
        """
        
        # Call Ollama local server via helper
        try:
            resp = ollama_generate(prompt=prompt, system_prompt=self.instruction, model=self.model, params={"temperature":0.0, "max_tokens":256})
        except OllamaError as e:
            raise ValueError(f"Ollama generate failed: {e}") from e

        # Return as string (could be JSON or raw text)
        return str(resp)

@app.get("/")
def home():
    return {"message": "Poker Backend Running"}

# This is where your React frontend will call to 'trigger' a bot turn
@app.post("/play-turn")
async def play_turn(body: PlayTurnRequest):
    # 1. Fetch RAG snippets from ChromaDB (Logic to be added)
    # 2. Call the PokerAgent
    # 3. Return the decision to the UI
    # Placeholder response until RAG + agent are wired
    return {
        "action": "CALL",
        "amount": body.state.get("to_call", 0),
        "reasoning": "Placeholder: RAG and agent not yet wired.",
    }