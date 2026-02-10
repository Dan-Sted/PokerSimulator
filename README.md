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
- Handle Books and chunk generation: Dan
- Get gemini API's set up for everyone
- Build out frontEnd: JC and Alex
- Build out docs
- Build out Backend
- VectorDB: Srihari and Dylan
