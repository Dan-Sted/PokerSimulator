import os
from langchain_community.document_loaders import TextLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import Chroma
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from dotenv import load_dotenv

load_dotenv()

# Initialize Embeddings (Uses Gemini's embedding model)
embeddings = GoogleGenerativeAIEmbeddings(model="models/embedding-001")

def ingest_all_pros(data_dir="./data"):
    # Initialize/Connect to local ChromaDB
    # We use a separate collection for each pro to avoid cross-contamination
    for pro_name in os.listdir(data_dir):
        pro_path = os.path.join(data_dir, pro_name)
        
        if os.path.isdir(pro_path):
            print(f"--- Processing Knowledge for: {pro_name} ---")
            
            # 1. Load all text files in the pro's folder
            documents = []
            for file in os.listdir(pro_path):
                if file.endswith(".txt"):
                    loader = TextLoader(os.path.join(pro_path, file))
                    documents.extend(loader.load())
            
            if not documents: continue

            # 2. Chunking Logic (CSE Tip: Overlap prevents context loss at the edges)
            text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=1000, 
                chunk_overlap=100
            )
            chunks = text_splitter.split_documents(documents)

            # 3. Store in a named collection for this specific pro
            Chroma.from_documents(
                documents=chunks,
                embedding=embeddings,
                persist_directory="./database",
                collection_name=f"pro_{pro_name.lower()}"
            )
            print(f"Successfully indexed {len(chunks)} chunks for {pro_name}")

if __name__ == "__main__":
    ingest_all_pros()