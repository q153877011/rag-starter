#!/usr/bin/env python3
"""
prepare_rag_data.py — 扫描 ./files/ 目录，把 RAG 知识库写入项目的私有数据目录。

直接运行（无需任何参数）：
  cd public/prepare-rag
  python3 prepare_rag_data.py

输出目录布局（位于 <项目根>/agents/_data/）：
  agents/_data/
  ├── index.json                       ← 全文档清单（替代 listDocuments）
  └── {docId}/
      ├── meta.json                    ← 文档元信息
      ├── structure.json (可选)        ← PageIndex 树状索引
      └── pages/
          ├── 1.txt
          ├── 2.txt
          └── ...

目录约定（输入）：
  public/prepare-rag/
  ├── files/
  │   ├── 年报2025.pdf            ← 必须
  │   ├── 年报2025.json           ← 可选，PageIndex 索引（与 PDF 同名）
  │   └── ...
  ├── prepare_rag_data.py
  └── requirements.txt

执行流程：
  1. 扫描 ./files/*.pdf，每个 PDF 以文件名（不含扩展名）作为 doc_id
  2. 若存在同名 .json，作为 PageIndex 树状索引一并输出
  3. 清空 agents/_data/ 并全量重建
  4. 生成 agents/_data/index.json 作为运行时清单

⚠️ 该目录不会被 express.static 暴露，只由服务端读取（见 agents/loader.js）。
"""

import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

# ── 配置 ──────────────────────────────────────────────────────────────────────

FILES_DIR = Path(__file__).parent / "files"

# 脚本路径：public/prepare-rag/prepare_rag_data.py
# 数据目标：agents/_data/（即本文件往上 2 级到项目根，再进 agents/_data）
PROJECT_ROOT = Path(__file__).parent.parent.parent
AGENTS_DIR = PROJECT_ROOT / "agents"
RAG_OUT_DIR = AGENTS_DIR / "_data"


# ── PDF 文本提取 ───────────────────────────────────────────────────────────────

def load_pdf_reader():
    """导入 pypdf 或 PyPDF2，两者都没有则报错退出"""
    try:
        from pypdf import PdfReader
        return PdfReader
    except ImportError:
        pass
    try:
        from PyPDF2 import PdfReader
        return PdfReader
    except ImportError:
        print("❌ 缺少 PDF 依赖，请先运行: pip install -r requirements.txt", file=sys.stderr)
        sys.exit(1)


def extract_pages(pdf_path: Path, PdfReader) -> tuple[dict[int, str], int]:
    """逐页提取 PDF 纯文本，返回 {页码: 文本} 和总页数"""
    reader = PdfReader(str(pdf_path))
    pages: dict[int, str] = {}
    for i, page in enumerate(reader.pages):
        try:
            text = page.extract_text() or ""
        except Exception as e:
            print(f"    ⚠️  第 {i + 1} 页提取失败: {e}", file=sys.stderr)
            text = ""
        pages[i + 1] = text.strip()
    return pages, len(reader.pages)


# ── doc_id 处理 ────────────────────────────────────────────────────────────────

def sanitize_doc_id(name: str) -> str:
    """将文件名转换为合法的 doc_id（只保留字母数字下划线连字符）"""
    s = name.strip()
    s = re.sub(r"[\s.]+", "_", s)
    s = re.sub(r"[^\w\-]", "", s)
    s = s.strip("_")
    return s or "doc"


# ── 写入单个文档 ────────────────────────────────────────────────────────────────

def write_document(
    pdf_path: Path,
    PdfReader,
    doc_id: str,
) -> dict:
    """为单个 PDF 写入 meta.json / structure.json / pages/{n}.txt，返回 index.json 条目"""
    print(f"\n  📄 {pdf_path.name}  →  doc_id: {doc_id}")

    # 1. 提取 PDF 文本
    pages, page_count = extract_pages(pdf_path, PdfReader)
    text_pages = sum(1 for t in pages.values() if t)
    print(f"     共 {page_count} 页，有文字 {text_pages} 页")

    # 2. 尝试加载同名 PageIndex JSON 索引
    index_path = pdf_path.with_suffix(".json")
    index_data: dict = {}
    if index_path.exists():
        with open(index_path, "r", encoding="utf-8") as f:
            index_data = json.load(f)
        print(f"     索引: {index_path.name}  根节点: «{index_data.get('title', '无标题')}»")
    else:
        print(f"     索引: 未找到 {index_path.name}，跳过 structure.json")

    doc_name = index_data.get("title") or pdf_path.stem

    # 3. 准备输出目录
    doc_dir = RAG_OUT_DIR / doc_id
    pages_dir = doc_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)

    # 4. 写 meta.json
    meta_payload = {
        "doc_name":        doc_name,
        "doc_description": index_data.get("summary", ""),
        "type":            "pdf",
        "page_count":      page_count,
        "status":          "completed",
        "created":         datetime.now(timezone.utc).isoformat(),
    }
    meta_path = doc_dir / "meta.json"
    meta_text = json.dumps(meta_payload, ensure_ascii=False, indent=2)
    meta_path.write_text(meta_text, encoding="utf-8")
    meta_bytes = len(meta_text.encode("utf-8"))

    # 5. 写 structure.json（可选）
    structure_bytes = 0
    has_structure = bool(index_data)
    if has_structure:
        structure_text = json.dumps(index_data, ensure_ascii=False, indent=2)
        (doc_dir / "structure.json").write_text(structure_text, encoding="utf-8")
        structure_bytes = len(structure_text.encode("utf-8"))

    # 6. 逐页原文（跳过空页）
    page_bytes = 0
    written_pages = 0
    skipped = 0
    for page_num, text in pages.items():
        if not text:
            skipped += 1
            continue
        page_file = pages_dir / f"{page_num}.txt"
        page_file.write_text(text, encoding="utf-8")
        page_bytes += len(text.encode("utf-8"))
        written_pages += 1

    if skipped:
        print(f"     跳过 {skipped} 个空页（纯图片页）")

    total_bytes = meta_bytes + structure_bytes + page_bytes
    print(
        f"     写入文件: 1 meta + {'1' if has_structure else '0'} structure + "
        f"{written_pages} pages  ({total_bytes / 1024:.1f} KB)"
    )

    return {
        "docId":          doc_id,
        "meta":           meta_payload,
        "hasStructure":   has_structure,
        "pages":          written_pages,
        "metaBytes":      meta_bytes,
        "structureBytes": structure_bytes,
        "pageBytes":      page_bytes,
        "totalBytes":     total_bytes,
    }


# ── 主流程 ─────────────────────────────────────────────────────────────────────

def main() -> None:
    print("=" * 60)
    print("  RAG 数据生成工具  —  PageIndex")
    print("=" * 60)

    # 检查 files 目录
    if not FILES_DIR.exists():
        print(f"❌ 目录不存在: {FILES_DIR}", file=sys.stderr)
        sys.exit(1)

    pdf_files = sorted(FILES_DIR.glob("*.pdf"))
    if not pdf_files:
        print(f"⚠️  {FILES_DIR} 目录下没有找到任何 PDF 文件")
        sys.exit(0)

    print(f"\n📁 扫描目录: {FILES_DIR}")
    print(f"   发现 {len(pdf_files)} 个 PDF 文件:")
    for p in pdf_files:
        has_index = p.with_suffix(".json").exists()
        marker = "  ✦" if has_index else "  ·"
        print(f"{marker} {p.name}" + (" [含索引]" if has_index else ""))

    # 清空并重建输出目录
    if RAG_OUT_DIR.exists():
        print(f"\n🗑️  清空旧目录: {RAG_OUT_DIR}")
        shutil.rmtree(RAG_OUT_DIR)
    RAG_OUT_DIR.mkdir(parents=True, exist_ok=True)

    # 加载 PDF 解析库
    PdfReader = load_pdf_reader()

    # 逐个写入
    print("\n── 写入文档内容 " + "─" * 40)
    index_entries: list[dict] = []
    used_ids: list[str] = []

    for pdf_path in pdf_files:
        doc_id = sanitize_doc_id(pdf_path.stem)
        if doc_id in used_ids:
            doc_id = f"{doc_id}_{len(used_ids)}"
        used_ids.append(doc_id)

        entry = write_document(pdf_path, PdfReader, doc_id)
        index_entries.append(entry)

    # 汇总统计
    total_bytes = sum(e["totalBytes"] for e in index_entries)

    # 写 index.json
    index_payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "documents":    index_entries,
    }
    index_path = RAG_OUT_DIR / "index.json"
    index_path.write_text(
        json.dumps(index_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"\n── 汇总 " + "─" * 48)
    print(f"   文档数:     {len(pdf_files)}")
    print(f"   总数据量:   {total_bytes / 1024:.1f} KB  ({total_bytes / 1024 / 1024:.2f} MB)")
    print(f"   输出目录:   {RAG_OUT_DIR.relative_to(PROJECT_ROOT)}")
    print(f"   清单文件:   {index_path.relative_to(PROJECT_ROOT)}")

    print("\n" + "=" * 60)
    print("  ✅ RAG 数据生成完成！")
    print("=" * 60)
    for doc_id in used_ids:
        print(f"   doc_id: {doc_id}")
    print()


if __name__ == "__main__":
    main()
