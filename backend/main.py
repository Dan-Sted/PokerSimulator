import os
from dotenv import load_dotenv
from fastapi import FastAPI
from google import genai
from google.genai import types

load_dotenv()

# Initialize the 2026 Client
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
app = FastAPI()

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
        
        response = client.models.generate_content(
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
async def play_turn(player_name: str, state: dict):
    # 1. Fetch RAG snippets from ChromaDB (Logic to be added)
    # 2. Call the PokerAgent
    # 3. Return the decision to the UI
    pass