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


# TODO:
- Get rest of books
- Create chunks from books
- Get gemini API's set up for everyone
- Build out frontEnd
- Build out docs
- Build out Backend
