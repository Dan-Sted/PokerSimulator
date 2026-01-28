from pypokerengine.api.game import setup_config, start_poker
from pypokerengine.players import BasePokerPlayer
import pypokerengine.utils.visualize_utils as U

# A bot that just calls everything (The "Fish")
class FishPlayer(BasePokerPlayer):
    def declare_action(self, valid_actions, hole_card, round_state):
        call_action_info = valid_actions[1]
        return call_action_info['action'], call_action_info['amount']

    def receive_game_start_message(self, game_info): pass
    def receive_round_start_message(self, round_count, hole_card, seats): pass
    def receive_street_start_message(self, street, round_state): pass
    def receive_game_update_message(self, action, round_state): pass
    def receive_round_result_message(self, winners, hand_info, round_state): pass

# A bot you can control through the terminal
class ConsolePlayer(BasePokerPlayer):
    def declare_action(self, valid_actions, hole_card, round_state):
        print(U.visualize_declare_action(valid_actions, hole_card, round_state, self.uuid))
        action = input("Enter action (fold/call/raise): ").lower()
        amount = 0
        if action == 'call':
            amount = valid_actions[1]['amount']
        elif action == 'raise':
            amount = int(input(f"Enter amount ({valid_actions[2]['amount']['min']}-{valid_actions[2]['amount']['max']}): "))
        return action, amount

    def receive_game_start_message(self, game_info): pass
    def receive_round_start_message(self, round_count, hole_card, seats): pass
    def receive_street_start_message(self, street, round_state): pass
    def receive_game_update_message(self, action, round_state): pass
    def receive_round_result_message(self, winners, hand_info, round_state):
        print(f"Round Over! Winner: {winners[0]['name']}")

def run_test_game():
    config = setup_config(max_round=5, initial_stack=1000, small_blind_amount=10)
    
    # Register 2 bots and 1 human (you)
    config.register_player(name="Bot_1", algorithm=FishPlayer())
    config.register_player(name="Bot_2", algorithm=FishPlayer())
    config.register_player(name="Human", algorithm=ConsolePlayer())
    
    game_result = start_poker(config, verbose=1)
    print("\n--- Final Tournament Standings ---")
    for player in game_result['players']:
        print(f"{player['name']}: {player['stack']} chips")

if __name__ == "__main__":
    run_test_game()