from google import genai
from dotenv import load_dotenv
import os
import chromadb

load_dotenv()

persistent_path = "./backend/database"

class Player:
    def __init__(self, name, model="gemini-3-flash-preview"):
        self.name = name
        self.model = model

key=os.getenv("GEMINI_API_KEY")

client = genai.Client(api_key=key)

with open('backend/llm/personality_prompts/shark_prompt.txt', 'r') as f:
    prompt = f.read()
    print(prompt)

with open('backend/llm/test_prompts/preflop.txt', 'r') as f:
    test_prompt = f.read()
    print(test_prompt)

db_client = chromadb.PersistentClient(path=persistent_path)
collection = db_client.get_or_create_collection(name="books")

docs = collection.query(query_texts=test_prompt, n_results=1)
print(docs)

test_prompt = test_prompt + docs['documents'][0][0] + "It's your turn. Respond with your action in JSON format."
print(test_prompt)

chat = client.chats.create(model="gemini-3-flash-preview")
response1 = chat.send_message(prompt)
print(response1.text)

response2 = chat.send_message(test_prompt)
print(response2.text)


