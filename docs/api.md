# API Reference

Base URL (local): `http://127.0.0.1:8000`

Interactive docs: `http://127.0.0.1:8000/docs` (Swagger UI)

## Endpoints

### Health Check

#### `GET /`

Returns a simple status message to verify the backend is running.

**Response**
```json
{
  "message": "Poker Backend Running"
}
```

**Example**
```bash
curl http://127.0.0.1:8000/
```

---

### Play Turn (AI Decision)

#### `POST /play-turn`

Triggers an AI bot turn. Intended flow: fetch RAG context, call PokerAgent, return the decision.

**Status:** Placeholder — retrieval and agent logic are not yet wired up.

**Parameters** (expected shape; implementation may vary)

| Name         | Type   | Description                         |
|--------------|--------|-------------------------------------|
| `player_name`| string | Name of the pro (maps to RAG collection) |
| `state`      | object | Current game state                  |

**Expected `state` fields (example)**

- `hole_cards` — Player's private cards
- `community_cards` — Board cards
- `pot` — Current pot size
- `to_call` — Amount to call
- `valid_actions` — Available actions (fold, call, raise, etc.)
- Other round metadata as needed

**Response** (planned format)

```json
{
  "action": "CALL",
  "amount": 0,
  "reasoning": "Based on position and pot odds..."
}
```

| Field      | Type   | Description                    |
|------------|--------|--------------------------------|
| `action`   | string | `"FOLD"`, `"CALL"`, or `"RAISE"` |
| `amount`   | number | Raise amount (0 for fold/call) |
| `reasoning`| string | Optional explanation          |

**Example request**
```bash
curl -X POST "http://127.0.0.1:8000/play-turn" \
  -H "Content-Type: application/json" \
  -d '{"player_name": "pro_1", "state": { ... }}'
```

---

## Error Responses

Standard HTTP status codes apply. Error responses will follow FastAPI's default structure when implemented.

---

## CORS

If the frontend runs on a different origin (e.g. `localhost:5173`), ensure CORS is configured in the FastAPI app so browser requests are allowed.
