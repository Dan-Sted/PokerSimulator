import os
from langchain_community.document_loaders import TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from dotenv import load_dotenv
import chromadb
import argparse
import shutil

load_dotenv()

persistent_path = "./backend/database"

# Book filename → collection name mapping
BOOK_COLLECTIONS = {
    "sklanskyBookText.txt": "sklansky",
    "negreanuBookText.txt": "negreanu",
    "rounderBookText.txt":  "rounder",
    "seidmanBookText.txt":  "seidman",
    "dummiesBookText.txt":  "dummies",
}

def chunk(txt):
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=250)
    chunks = text_splitter.split_text(txt)
    return chunks

def ingest_book(client, book_filename, collection_name):
    """Ingest a single book into its own collection."""
    collection = client.get_or_create_collection(name=collection_name)
    path = f'./backend/books/{book_filename}'
    print(f"Ingesting {book_filename} → collection '{collection_name}'")
    loader = TextLoader(path, autodetect_encoding=True)
    documents = loader.load()
    chunks = chunk(documents[0].page_content)
    collection.add(
        documents=chunks,
        metadatas=[{"source": book_filename} for _ in range(len(chunks))],
        ids=[str(i) for i in range(len(chunks))],
    )
    print(f"  Added {len(chunks)} chunks")

def ingest_all(client):
    """Ingest all books, each into its own collection."""
    for book_filename, collection_name in BOOK_COLLECTIONS.items():
        ingest_book(client, book_filename, collection_name)

def query(collection, query_text):
    docs = collection.query(query_texts=query_text, n_results=5)
    return docs

if __name__ == "__main__":
    argparser = argparse.ArgumentParser()
    argparser.add_argument("--rebuild", default=False, action="store_true")
    rebuild = argparser.parse_args().rebuild

    if rebuild:
        if os.path.exists(persistent_path):
            shutil.rmtree(persistent_path)
            print(f"Deleted database at '{persistent_path}'")

    client = chromadb.PersistentClient(path=persistent_path)

    ingest_all(client)

    # Test query against one collection
    test_collection = client.get_or_create_collection(name="sklansky")
    test_query = "You have J of heart and J of spades in the hole. The flop is 3 of spade, 4 of hearts, and J of clubs, whats the move"
    docs = query(test_collection, test_query)
    print(docs)
