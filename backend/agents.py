import os
import json
import re
import time
import chromadb
from google import genai
from google.genai import errors as genai_errors
from pypokerengine.players import BasePokerPlayer
from dotenv import load_dotenv

load_dotenv()

# Resolve paths relative to this file's directory
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
PERSISTENT_PATH = os.path.join(_THIS_DIR, "database")

# Book key → (collection name, personality name, prompt file)
PLAYER_CONFIGS = {
    "sklansky": ("sklansky", "Calculator", "calculator_prompt.txt"),
    "negreanu": ("negreanu", "Shark",      "shark_prompt.txt"),
    "rounder":  ("rounder",  "Gambler",    "gambler_prompt.txt"),
    "seidman":  ("seidman",  "Maniac",     "maniac_prompt.txt"),
    "dummies":  ("dummies",  "Rock",       "rock_prompt.txt"),
}


class LLMPlayer(BasePokerPlayer):
    def __init__(self, config_key):
        super().__init__()
        collection_name, self.personality, prompt_file = PLAYER_CONFIGS[config_key]

        # Load personality prompt
        prompt_path = os.path.join(_THIS_DIR, "llm", "personality_prompts", prompt_file)
        with open(prompt_path, "r") as f:
            self.system_prompt = f.read()

        # ChromaDB collection for this player's book
        db_client = chromadb.PersistentClient(path=PERSISTENT_PATH)
        self.collection = db_client.get_or_create_collection(name=collection_name)

        # Gemini client
        self.gemini_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        self.model = "gemini-2.5-flash"

    def declare_action(self, valid_actions, hole_card, round_state):
        # Format the game state
        game_state_text = self._format_game_state(valid_actions, hole_card, round_state)

        # Query this player's book collection for relevant snippets
        docs = self.collection.query(query_texts=game_state_text, n_results=3)
        snippets = "\n\n".join(docs["documents"][0]) if docs["documents"][0] else ""

        # Build the user message with book context + game state
        user_message = (
            f"{game_state_text}\n\n"
            f"Reference Material:\n{snippets}\n\n"
            f"It's your turn. Respond with your action in JSON format."
        )

        # Send to Gemini via chat interface (personality prompt first, then game state)
        # Retry on transient 503/429 errors
        response = None
        for attempt in range(5):
            try:
                chat = self.gemini_client.chats.create(model=self.model)
                chat.send_message(self.system_prompt)
                response = chat.send_message(user_message)
                break
            except genai_errors.ServerError:
                wait = 2 ** attempt
                print(f"[{self.personality}] Gemini 503, retrying in {wait}s...")
                time.sleep(wait)
            except genai_errors.ClientError:
                wait = 2 ** attempt
                print(f"[{self.personality}] Gemini 429, retrying in {wait}s...")
                time.sleep(wait)

        if response is None:
            # All retries exhausted — fallback to call
            return valid_actions[1]["action"], valid_actions[1]["amount"]

        # Parse and validate the response
        action, amount = self._parse_response(response.text, valid_actions)
        return action, amount

    def _format_game_state(self, valid_actions, hole_card, round_state):
        """Format PyPokerEngine state into the text format the personality prompts expect."""
        community_cards = round_state.get("community_card", [])
        pot = round_state["pot"]["main"]["amount"]
        street = round_state["street"]

        # Find this player's stack
        my_stack = 0
        for seat in round_state["seats"]:
            if seat["uuid"] == self.uuid:
                my_stack = seat["stack"]
                break

        to_call = valid_actions[1]["amount"]
        min_raise = valid_actions[2]["amount"]["min"]

        # Build opponents section
        opponents_lines = []
        for seat in round_state["seats"]:
            if seat["uuid"] != self.uuid:
                state = seat["state"]
                name = seat["name"]
                stack = seat["stack"]
                if state == "folded":
                    opponents_lines.append(f"- {name}: folded (stack: {stack})")
                elif state == "allin":
                    opponents_lines.append(f"- {name}: all-in (stack: {stack})")
                else:
                    opponents_lines.append(f"- {name}: active (stack: {stack})")
        opponents_text = "\n".join(opponents_lines)

        # Build action history
        history_lines = []
        for street_name, actions in round_state.get("action_histories", {}).items():
            for act in actions:
                player_name = act.get("uuid", "unknown")
                action_type = act.get("action", "")
                amt = act.get("amount", 0)
                if action_type == "FOLD":
                    history_lines.append(f"- {player_name} folds")
                elif action_type == "CALL":
                    history_lines.append(f"- {player_name} calls {amt}")
                elif action_type == "RAISE":
                    history_lines.append(f"- {player_name} raises to {amt}")
                elif action_type == "SMALLBLIND":
                    history_lines.append(f"- {player_name} posts small blind {amt}")
                elif action_type == "BIGBLIND":
                    history_lines.append(f"- {player_name} posts big blind {amt}")
        history_text = "\n".join(history_lines) if history_lines else "None"

        return (
            f"GAME STATE:\n"
            f"- hole_cards: {hole_card}\n"
            f"- community_cards: {community_cards}\n"
            f"- pot: {pot}\n"
            f"- your_stack: {my_stack}\n"
            f"- to_call: {to_call}\n"
            f"- min_raise: {min_raise}\n"
            f"- betting_round: {street}\n"
            f"\nOPPONENTS:\n{opponents_text}\n"
            f"\nACTION HISTORY THIS ROUND:\n{history_text}"
        )

    def _parse_response(self, response_text, valid_actions):
        """Parse Gemini JSON response and validate against valid_actions."""
        # Extract JSON from response (may be wrapped in markdown code fences)
        json_match = re.search(r'\{[^{}]*\}', response_text, re.DOTALL)
        if not json_match:
            # Fallback: just call
            return valid_actions[1]["action"], valid_actions[1]["amount"]

        try:
            parsed = json.loads(json_match.group())
        except json.JSONDecodeError:
            return valid_actions[1]["action"], valid_actions[1]["amount"]

        action = parsed.get("action", "call").lower()
        amount = parsed.get("amount")

        # Map "check" to "call" with amount 0 (PyPokerEngine uses call/0 for check)
        if action == "check":
            action = "call"
            amount = 0

        # Validate action
        valid_action_names = [a["action"] for a in valid_actions]
        if action not in valid_action_names:
            return valid_actions[1]["action"], valid_actions[1]["amount"]

        # Validate amounts
        if action == "fold":
            amount = 0
        elif action == "call":
            amount = valid_actions[1]["amount"]
        elif action == "raise":
            min_r = valid_actions[2]["amount"]["min"]
            max_r = valid_actions[2]["amount"]["max"]
            if amount is None:
                amount = min_r
            amount = max(min_r, min(int(amount), max_r))

        return action, amount

    def receive_game_start_message(self, game_info): pass
    def receive_round_start_message(self, round_count, hole_card, seats): pass
    def receive_street_start_message(self, street, round_state): pass
    def receive_game_update_message(self, action, round_state): pass
    def receive_round_result_message(self, winners, hand_info, round_state): pass
