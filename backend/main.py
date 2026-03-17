import os
import json
import re
import asyncio
import chromadb
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Literal
from google import genai

load_dotenv()

_THIS_DIR       = os.path.dirname(os.path.abspath(__file__))
PERSISTENT_PATH = os.path.join(_THIS_DIR, "database")

# Personality name → (chromadb collection, prompt file)
PLAYERS = {
    "Calculator": ("sklansky", "calculator_prompt.txt"),
    "Shark":      ("negreanu", "shark_prompt.txt"),
    "Gambler":    ("rounder",  "gambler_prompt.txt"),
    "Maniac":     ("seidman",  "maniac_prompt.txt"),
    "Rock":       ("dummies",  "rock_prompt.txt"),
}

_db = chromadb.PersistentClient(path=PERSISTENT_PATH)
_collections = {
    name: _db.get_or_create_collection(collection)
    for name, (collection, _) in PLAYERS.items()
}

def _load_prompt(filename: str) -> str:
    path = os.path.join(_THIS_DIR, "llm", "personality_prompts", filename)
    with open(path) as f:
        return f.read()

_prompts       = {name: _load_prompt(pfile) for name, (_, pfile) in PLAYERS.items()}
_client               = None
_browser_ready        = False
_initialized_players: set = set()

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


class BrowserInitRequest(BaseModel):
    players: list[str] = []

class PlayTurnRequest(BaseModel):
    player_name: str
    state: dict
    mode: Literal["api", "browser"] = "browser"


def _format_state(state: dict) -> str:
    def fmt_card(c):
        return f"{c.get('rank', '?')}{c.get('suit', '?')}"

    hole      = ", ".join(fmt_card(c) for c in state.get("hole_cards", []))
    community = ", ".join(fmt_card(c) for c in state.get("community_cards", [])) or "none"

    return (
        f"GAME STATE:\n"
        f"- hole_cards: {hole}\n"
        f"- community_cards: {community}\n"
        f"- pot: {state.get('pot', 0)}\n"
        f"- to_call: {state.get('to_call', 0)}\n"
        f"- your_stack: {state.get('stack', 0)}\n"
        f"- street: {state.get('street', 'preflop')}\n"
        f"- valid_actions: {', '.join(state.get('valid_actions', ['fold', 'call', 'raise']))}"
    )


def _parse_response(response_text: str, valid_actions: list) -> dict:
    match = re.search(r'\{[^{}]*\}', response_text, re.DOTALL)
    if not match:
        return {"action": "call", "amount": 0, "reasoning": "Could not parse response."}
    try:
        parsed = json.loads(match.group())
    except json.JSONDecodeError:
        return {"action": "call", "amount": 0, "reasoning": "JSON parse error."}

    action = parsed.get("action", "call").lower()
    if action == "check":
        action = "call"
    if action not in valid_actions:
        action = "call"

    return {
        "action": action,
        "amount": parsed.get("amount", 0),
        "reasoning": parsed.get("reasoning", ""),
    }


def _build_prompt(player_name: str, state: dict) -> tuple[str, list]:
    state_text    = _format_state(state)
    valid_actions = state.get("valid_actions", ["fold", "call", "raise"])
    docs          = _collections[player_name].query(query_texts=[state_text], n_results=3)
    snippets      = "\n\n".join(docs["documents"][0]) if docs["documents"][0] else ""
    prompt = (
        f"{state_text}\n\n"
        f"Reference Material:\n{snippets}\n\n"
        'It\'s your turn. Respond in JSON: {"action": "fold|call|raise", "amount": 0, "reasoning": "..."}'
    )
    return prompt, valid_actions


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/")
def home():
    return {"message": "Poker Backend Running"}


@app.get("/browser/status")
def browser_status():
    return {"ready": _browser_ready}


@app.get("/browser/session-status")
def browser_session_status():
    from gemini_browser import STATE_FILE
    return {"has_session": os.path.exists(STATE_FILE)}


@app.post("/browser/login")
def browser_login():
    from gemini_browser import start_login_flow
    start_login_flow()  # non-blocking — opens Chrome and returns immediately
    return {"status": "login_browser_opened"}


@app.post("/browser/login-confirm")
async def browser_login_confirm():
    from gemini_browser import confirm_login
    await asyncio.to_thread(confirm_login)  # blocks until session is saved
    from gemini_browser import STATE_FILE
    return {"status": "session_saved", "has_session": os.path.exists(STATE_FILE)}


@app.delete("/browser/session")
def browser_clear_session():
    from gemini_browser import STATE_FILE
    if os.path.exists(STATE_FILE):
        os.remove(STATE_FILE)
        return {"status": "cleared"}
    return {"status": "no_session"}


@app.post("/browser/shutdown")
async def browser_shutdown():
    global _browser_ready, _initialized_players
    if not _browser_ready:
        return {"status": "not_initialized"}
    try:
        from gemini_browser import shutdown_browser
        await asyncio.to_thread(shutdown_browser)
        _browser_ready = False
        _initialized_players = set()
        return {"status": "shutdown"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/browser/init")
async def browser_init(body: BrowserInitRequest = None):
    global _browser_ready, _initialized_players
    player_ids = body.players if body and body.players else list(PLAYERS.keys())
    invalid = [p for p in player_ids if p not in PLAYERS]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Unknown players: {invalid}")

    new_players = [p for p in player_ids if p not in _initialized_players]
    if not new_players:
        return {"status": "already_initialized", "initialized": list(_initialized_players)}

    try:
        from gemini_browser import initialize_browser, init_player_chat, add_player
        if not _browser_ready:
            # First call — launch Chrome and open tabs for all requested players
            await asyncio.to_thread(initialize_browser, new_players)
        else:
            # Browser already running — open additional tabs for the new players only
            for player_name in new_players:
                await asyncio.to_thread(add_player, player_name)

        for player_name in new_players:
            await asyncio.to_thread(init_player_chat, player_name, _prompts[player_name])

        _initialized_players.update(new_players)
        _browser_ready = True
        return {"status": "initialized", "initialized": list(_initialized_players)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/play-turn")
async def play_turn(body: PlayTurnRequest):
    if body.player_name not in PLAYERS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown player '{body.player_name}'. Valid: {list(PLAYERS.keys())}",
        )

    user_prompt, valid_actions = _build_prompt(body.player_name, body.state)

    if body.mode == "browser":
        if not _browser_ready:
            raise HTTPException(
                status_code=503,
                detail="Browser not initialized. Click 'Init Browser' first.",
            )
        from gemini_browser import query_gemini_browser
        response_text = await asyncio.to_thread(query_gemini_browser, user_prompt, body.player_name)
        return _parse_response(response_text, valid_actions)

    # API mode
    if _client is None:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not set in .env")

    def _call_api():
        chat = _client.chats.create(model="gemini-2.5-flash")
        chat.send_message(_prompts[body.player_name])
        return chat.send_message(user_prompt)

    response = await asyncio.to_thread(_call_api)
    return _parse_response(response.text, valid_actions)
