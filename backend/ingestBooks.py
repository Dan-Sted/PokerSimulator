import os
from langchain_community.document_loaders import TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import Chroma
from dotenv import load_dotenv
import chromadb
import argparse

load_dotenv()

# Initialize Embeddings (Uses Gemini's embedding model)
persistent_path = "./backend/database"

def chunk(txt):
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=250)
    chunks = text_splitter.split_text(txt)
    return chunks

def add_books(collection):
    n_id = 0
    for book in os.listdir('./backend/books'):
        if book.endswith('.txt'):
            print(book)
            loader = TextLoader(f'./backend/books/{book}', autodetect_encoding=True)
            documents = loader.load()
            chunks = chunk(documents[0].page_content)
            collection.add(documents=chunks,
                           metadatas=[{"source": book} for _ in range(len(chunks))],
                           ids=[str(i) for i in range(n_id, n_id + len(chunks))])
            n_id += len(chunks)
            
def query(collection, query):
    docs = collection.query(query_texts=query, n_results=5)
    return docs

if __name__ == "__main__":
    argparser = argparse.ArgumentParser()
    argparser.add_argument("--rebuild", default=False, action="store_true")
    rebuild = argparser.parse_args().rebuild

    client = chromadb.PersistentClient(path=persistent_path)

    if rebuild:
        client.delete_collection("books")
        collection = client.get_or_create_collection(name="books")
        add_books(collection)
    else:
        collection = client.get_or_create_collection(name="books")

    test_query = "You have J of heart and J of spades in the hole. The flop is 3 of spade, 4 of hearts, and J of clubs, whats the move"
    docs = query(collection, test_query)
    print(docs)