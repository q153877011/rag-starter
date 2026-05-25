import { useState, useRef, useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import Markdown from "react-markdown";
import CitationCard from "./CitationCard";
import "./RagChat.css";

const PRESET_QUESTIONS = [
  "Tony 是谁？",
  "Tony 的工作经历是什么？",
  "Vercel 对 AI 的态度如何？",
];

const transport = new DefaultChatTransport({ api: "/api/chat/rag" });

export default function RagChat() {
  const { messages, status, error, sendMessage, setMessages, stop } = useChat({
    transport,
  });

  const [input, setInput] = useState("");
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, status]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    sendMessage({ text });
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePreset = (question) => {
    setInput("");
    sendMessage({ text: question });
  };

  const handleClear = () => {
    setMessages([]);
  };

  const isStreaming = status === "streaming" || status === "submitted";

  // Extract citations from assistant message parts
  const extractCitations = (parts) => {
    if (!parts) return [];
    return parts
      .filter(
        (part) =>
          part.type &&
          part.type.startsWith("tool-") &&
          part.state === "output-available"
      )
      .filter((part) => {
        const toolName = part.type.slice("tool-".length);
        return toolName === "fetchPages";
      })
      .map((part) => part.output);
  };

  // Get text content from message parts
  const getTextContent = (parts) => {
    if (!parts) return "";
    return parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
  };

  return (
    <div className="rag-chat">
      <div className="chat-header">
        <div className="chat-header-left">
          <div className="chat-indicator" />
          <span className="chat-title">Knowledge Query</span>
        </div>
        {messages.length > 0 && (
          <button className="chat-clear-btn" onClick={handleClear}>
            Clear
          </button>
        )}
      </div>

      <div className="chat-messages" ref={messagesContainerRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
            </div>
            <p className="chat-empty-title">Ask about your knowledge base</p>
            <p className="chat-empty-desc">
              Query documents with full citation traceability
            </p>
            <div className="preset-chips">
              {PRESET_QUESTIONS.map((q) => (
                <button
                  key={q}
                  className="preset-chip"
                  onClick={() => handlePreset(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`chat-message chat-message--${msg.role}`}>
            <div className="message-role-tag">
              {msg.role === "user" ? "You" : "Agent"}
            </div>
            <div className="message-content">
              {msg.role === "assistant" ? (
                <Markdown>{getTextContent(msg.parts)}</Markdown>
              ) : (
                getTextContent(msg.parts)
              )}
            </div>
            {msg.role === "assistant" &&
              extractCitations(msg.parts).map((citation, idx) => (
                <CitationCard
                  key={idx}
                  docName={citation.docName}
                  docId={citation.docId}
                  pages={citation.pages}
                  pageCount={citation.pageCount}
                  totalChars={citation.totalChars}
                  content={citation.content}
                />
              ))}
          </div>
        ))}

        {isStreaming && (
          <div className="streaming-indicator">
            <div className="streaming-dots">
              <span />
              <span />
              <span />
            </div>
            <span className="streaming-text">Retrieving & generating...</span>
            <button className="stop-btn" onClick={stop}>
              Stop
            </button>
          </div>
        )}

        {error && (
          <div className="chat-error">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <span>{error.message || "An error occurred"}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {messages.length > 0 && (
        <div className="preset-chips preset-chips--inline">
          {PRESET_QUESTIONS.map((q) => (
            <button
              key={q}
              className="preset-chip preset-chip--small"
              onClick={() => handlePreset(q)}
              disabled={isStreaming}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <div className="chat-input-bar">
        <input
          type="text"
          className="chat-input"
          placeholder="Ask a question about your documents..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={!input.trim() || isStreaming}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
