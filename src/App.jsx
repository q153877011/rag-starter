import RagChat from "./components/RagChat";
import KnowledgeBaseSummary from "./components/KnowledgeBaseSummary";
import "./App.css";

export default function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <div className="brand-mark" />
          <div className="brand-text">
            <h1>Enterprise RAG Agent</h1>
            <p>基于企业知识库的可溯源问答</p>
          </div>
        </div>
      </header>
      <main className="app-main">
        <KnowledgeBaseSummary />
        <RagChat />
      </main>
    </div>
  );
}
