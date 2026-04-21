import os
import json
import re
import asyncio
import chromadb
from itertools import combinations
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Literal
from google import genai
from pypokerengine.engine.card import Card

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
    mode: Literal["api", "browser", "ollama"] = "browser"


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


class GeminiKeyRequest(BaseModel):
    key: str

@app.get("/settings/gemini-key")
def get_gemini_key_status():
    return {"has_key": _client is not None}

@app.post("/settings/gemini-key")
def set_gemini_key(body: GeminiKeyRequest):
    global _client
    key = body.key.strip()
    if not key:
        _client = None
        # Remove the key from .env
        _update_env_key("")
        return {"ok": True, "has_key": False}
    try:
        _client = genai.Client(api_key=key)
        _update_env_key(key)
        return {"ok": True, "has_key": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid key: {e}")

def _update_env_key(key: str):
    """Write or update GEMINI_API_KEY in the .env file."""
    env_path = os.path.join(_THIS_DIR, ".env")
    lines = []
    found = False
    if os.path.exists(env_path):
        with open(env_path) as f:
            lines = f.readlines()
    new_lines = []
    for line in lines:
        if line.startswith("GEMINI_API_KEY="):
            if key:
                new_lines.append(f"GEMINI_API_KEY={key}\n")
            found = True
        else:
            new_lines.append(line)
    if not found and key:
        new_lines.append(f"GEMINI_API_KEY={key}\n")
    with open(env_path, "w") as f:
        f.writelines(new_lines)


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
    try:
        from gemini_browser import shutdown_browser
        await asyncio.to_thread(shutdown_browser)
    except Exception:
        pass  # always reset state even if shutdown errors
    _browser_ready = False
    _initialized_players = set()
    return {"status": "shutdown"}


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

    if body.mode == "ollama":
        from llm.ollama_client import generate as ollama_generate, OllamaError
        def _call_ollama():
            try:
                return ollama_generate(
                    prompt=user_prompt,
                    system_prompt=_prompts[body.player_name],
                    params={"temperature": 0.0, "max_tokens": 256},
                )
            except OllamaError as e:
                raise HTTPException(status_code=503, detail=f"Ollama error: {e}")
        response_text = await asyncio.to_thread(_call_ollama)
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


# ── Hand evaluation endpoint ───────────────────────────────────────────────────

class CardModel(BaseModel):
    rank: str   # '2'-'9', 'T', 'J', 'Q', 'K', 'A'
    suit: str   # 'S', 'H', 'D', 'C'

class PlayerHandModel(BaseModel):
    name: str
    hole_cards: list[CardModel]

class EvaluateHandsRequest(BaseModel):
    players: list[PlayerHandModel]
    community_cards: list[CardModel]

def _to_card(c: CardModel) -> Card:
    # pypokerengine Card.from_str expects e.g. 'CA' (Club Ace), 'H2' (Heart 2)
    return Card.from_str(c.suit + c.rank)

# ── Deterministic hand evaluator ─────────────────────────────────────────────
# pypokerengine's eval_hand() is a Monte Carlo estimate and cannot reliably
# break ties (e.g. Two Pair 9s-6s vs Two Pair 7s-6s).  We use a pure Python
# evaluator that produces a fully-ordered comparable tuple instead.

_RANK_VAL = {'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,
             'T':10,'J':11,'Q':12,'K':13,'A':14}

_HAND_NAMES = [
    "High Card", "One Pair", "Two Pair", "Three of a Kind",
    "Straight", "Flush", "Full House", "Four of a Kind", "Straight Flush",
]

def _rank_five(cards):
    """Return a comparable tuple for exactly 5 cards (objects with .rank/.suit)."""
    vals  = sorted([c.rank for c in cards], reverse=True)
    suits = [c.suit for c in cards]

    is_flush    = len(set(suits)) == 1
    is_straight = len(set(vals)) == 5 and (vals[0] - vals[4]) == 4
    # Wheel: A-2-3-4-5
    if set(vals) == {14, 2, 3, 4, 5}:
        is_straight = True
        vals = [5, 4, 3, 2, 1]

    counts = {}
    for v in vals:
        counts[v] = counts.get(v, 0) + 1
    # Sort groups: highest count first, then highest card value first
    groups     = sorted(counts.items(), key=lambda x: (x[1], x[0]), reverse=True)
    gvals      = [v for v, _ in groups]
    gcounts    = [c for _, c in groups]

    if is_straight and is_flush:
        return (8, vals[0])
    if gcounts[0] == 4:
        return (7, gvals[0], gvals[1])
    if gcounts[:2] == [3, 2]:
        return (6, gvals[0], gvals[1])
    if is_flush:
        return (5, *vals)
    if is_straight:
        return (4, vals[0])
    if gcounts[0] == 3:
        return (3, gvals[0], gvals[1], gvals[2])
    if gcounts[:2] == [2, 2]:
        return (2, gvals[0], gvals[1], gvals[2])
    if gcounts[0] == 2:
        return (1, gvals[0], gvals[1], gvals[2], gvals[3])
    return (0, *vals)

def _best_rank(hole: list, community: list):
    """Best 5-card rank from up to 7 cards."""
    all_cards = hole + community
    return max(_rank_five(list(combo)) for combo in combinations(all_cards, 5))

def _hand_name(rank_tuple: tuple) -> str:
    return _HAND_NAMES[rank_tuple[0]]

@app.post("/evaluate-hands")
def evaluate_hands(body: EvaluateHandsRequest):
    community = [_to_card(c) for c in body.community_cards]

    ranks: dict[str, tuple] = {}
    hand_descriptions: dict[str, str] = {}
    for player in body.players:
        hole = [_to_card(c) for c in player.hole_cards]
        r = _best_rank(hole, community)
        ranks[player.name]            = r
        hand_descriptions[player.name] = _hand_name(r)

    best    = max(ranks.values())
    winners = [name for name, r in ranks.items() if r == best]

    return {
        "winners": winners,
        "hand_descriptions": hand_descriptions,
    }
