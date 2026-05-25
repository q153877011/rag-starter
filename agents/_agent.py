"""Agent definition: RAG Assistant."""

from agents import Agent

from ._model import llm_model
from ._tools import RAG_TOOLS

RAG_SYSTEM_PROMPT = (
    "You are an enterprise knowledge base assistant. "
    "When the user asks a question, you MUST follow these steps:\n"
    "1. Call search_document to find relevant documents in the knowledge base.\n"
    "2. Call fetch_pages to retrieve the exact page content.\n"
    "3. Answer the question based ONLY on the retrieved content.\n"
    "4. Always cite the source document name and page numbers in your answer.\n"
    "5. If the knowledge base does not contain relevant information, clearly state that.\n\n"
    "Always respond in the same language as the user's question. Always cite document sources with page numbers."
)

rag_agent = Agent(
    name="RAG Assistant",
    instructions=RAG_SYSTEM_PROMPT,
    tools=RAG_TOOLS,
    model=llm_model,
)
