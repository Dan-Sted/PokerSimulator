# API Reference

**Base URL (local):** `http://localhost:8000`

**Interactive docs:** `http://localhost:8000/docs` (Swagger UI)

All endpoints accept and return JSON. CORS is enabled for `http://localhost:5173`.

---

## Health

### `GET /`

Verify the backend is running.

**Response**
```json
{ "message": "Poker Backend Running" }
```

---

## Game — AI Turn

### `POST /play-turn`

Request an AI decision for a single player's turn. The backend selects the appropriate AI mode (ollama / api / browser), queries ChromaDB for relevant context, builds the prompt, and returns a parsed action.

**Request body**

```json
{
  "player_name": "Calculator",
  "mode": "ollama",
  "state": {
    "hole_cards":      [{ "rank": "A", "suit": "S" }, { "rank": "K", "suit": "H" }],
    "community_cards": [{ "rank": "Q", "suit": "D" }, { "rank": "J", "suit": "C" }, { "rank": "T", "suit": "S" }],
    "pot":             1200,
    "to_call":         200,
    "stack":           800,
    "street":          "flop",
    "valid_actions":   ["fold", "call", "raise"]
  }
}
```

| Field | Type | Values |
|-------|------|--------|
| `player_name` | string | `Calculator`, `Shark`, `Gambler`, `Maniac`, `Rock` |
| `mode` | string | `"ollama"`, `"api"`, `"browser"` |
| `state` | object | Current game state (see fields below) |

**State fields**

| Field | Type | Description |
|-------|------|-------------|
| `hole_cards` | Card[] | Player's two private cards |
| `community_cards` | Card[] | 0–5 board cards |
| `pot` | number | Current pot size |
| `to_call` | number | Amount required to call (0 = free check) |
| `stack` | number | Player's remaining chips |
| `street` | string | `preflop`, `flop`, `turn`, `river` |
| `valid_actions` | string[] | Available actions |

**Card object:** `{ "rank": "2"–"9" | "T" | "J" | "Q" | "K" | "A", "suit": "S" | "H" | "D" | "C" }`

**Response**

```json
{
  "action": "raise",
  "amount": 400,
  "reasoning": "Strong hand with nut straight on board. Value betting for maximum extraction."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `action` | string | `"fold"`, `"call"`, or `"raise"` |
| `amount` | number | Raise amount (0 for fold/call) |
| `reasoning` | string | AI's explanation |

**Errors**

| Status | Meaning |
|--------|---------|
| 503 | Ollama unavailable, API key not set, or browser not initialized |
| 500 | Unexpected server error |

---

## Game — Hand Evaluation

### `POST /evaluate-hands`

Determine the winner(s) from a showdown. Uses a deterministic pure-Python 7-card evaluator that correctly resolves all tiebreakers including kickers.

**Request body**

```json
{
  "players": [
    { "name": "Calculator", "hole_cards": [{ "rank": "9", "suit": "H" }, { "rank": "3", "suit": "D" }] },
    { "name": "Gambler",    "hole_cards": [{ "rank": "8", "suit": "H" }, { "rank": "7", "suit": "H" }] }
  ],
  "community_cards": [
    { "rank": "6", "suit": "D" }, { "rank": "J", "suit": "S" },
    { "rank": "6", "suit": "H" }, { "rank": "9", "suit": "S" },
    { "rank": "7", "suit": "S" }
  ]
}
```

**Response**

```json
{
  "winners": ["Calculator"],
  "hand_descriptions": {
    "Calculator": "Two Pair",
    "Gambler":    "Two Pair"
  }
}
```

Multiple winners are returned only for a true tie (identical best 5-card hand with equal kickers).

---

## Browser — Playwright Automation

These endpoints control the Playwright-managed Chromium browser used in **Browser** AI mode.

### `GET /browser/status`

Check whether the browser is initialized and ready.

```json
{ "ready": true }
```

### `GET /browser/session-status`

Check whether a saved Google session exists (so the user doesn't need to log in each time).

```json
{ "has_session": true }
```

### `POST /browser/init`

Open Chromium tabs and send system prompts for each player. This can take 30–120 seconds.

**Request body (optional)**

```json
{ "players": ["Calculator", "Shark", "Gambler"] }
```

If `players` is omitted, all 5 personalities are initialized.

**Response**

```json
{ "ok": true, "initialized": ["Calculator", "Shark", "Gambler"] }
```

### `POST /browser/shutdown`

Close all browser tabs and reset state.

```json
{ "ok": true }
```

### `DELETE /browser/session`

Delete the saved Playwright session file, forcing a fresh login next time.

```json
{ "ok": true }
```

### `POST /browser/login`

Open the Gemini login page so the user can sign in manually.

```json
{ "ok": true }
```

### `POST /browser/login-confirm`

Save the current browser session after the user has signed in.

```json
{ "ok": true }
```

---

## Settings

### `GET /settings/gemini-key`

Check whether a Gemini API key is currently configured (without exposing the key).

```json
{ "has_key": true }
```

### `POST /settings/gemini-key`

Set or clear the Gemini API key at runtime. The key is written to `.env` and takes effect immediately — no restart required.

**Request body**

```json
{ "key": "AIzaSy..." }
```

Pass an empty string to remove the key.

**Response**

```json
{ "ok": true, "has_key": true }
```

**Errors**

| Status | Meaning |
|--------|---------|
| 400 | Key rejected by the Gemini SDK (invalid format) |
