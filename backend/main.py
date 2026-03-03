import os
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai
from google.genai import types

load_dotenv()

# Initialize Gemini client only when API key is set (app still runs without it)
_client = None
if os.getenv("GEMINI_API_KEY"):
    _client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

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
        self.model = "gemini-2.0-flash" # High speed, low latency for games
        self.instruction = f"You are {name}, a professional poker player. Use the provided context from your books to make decisions."

    async def get_move(self, game_state, context_snippets):
        prompt = f"""
        CONTEXT FROM YOUR BOOKS:
        {context_snippets}

        GAME STATE:
        {game_state}

        What is your move? Respond in JSON: {{"action": "CALL|FOLD|RAISE", "amount": 0, "reasoning": "..."}}
        """
        
        if _client is None:
            raise ValueError("GEMINI_API_KEY not set; add it to .env to use the AI agent.")
        response = _client.models.generate_content(
            model=self.model,
            config=types.GenerateContentConfig(
                system_instruction=self.instruction,
                response_mime_type="application/json"
            ),
            contents=prompt
        )
        return response.text

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