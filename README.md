# PokerSimulator
Leveraging RAG LLMs to simulate poker

# Setup
cd backend
python3 -m venv venv
source venv/bin/activate

# Install the core local-first stack
pip install fastapi uvicorn ollama langchain langchain-community chromadb pysqlite3-binary
# Install poker logic engine
pip install PyPokerEngine
# Create a starting file
