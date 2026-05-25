/**
 * RAG 本地数据读取层
 *
 * 数据目录由 public/prepare-rag/prepare_rag_data.py 生成：
 *   agents/_data/
 *   ├── index.json                       ← 全文档清单
 *   └── {docId}/
 *       ├── meta.json                    ← 文档元信息
 *       ├── structure.json (可选)        ← PageIndex 树状索引
 *       └── pages/
 *           └── {n}.txt                  ← 第 n 页纯文本
 */

import fs from "node:fs/promises";
import path from "node:path";

// ── 类型定义 ─────────────────────────────────────────────────────────────────

export interface DocumentMeta {
	doc_name: string;
	doc_description: string;
	type: string;
	page_count: number;
	status: string;
	created: string;
}

export interface PageContent {
	page: number;
	content: string;
}

export interface DocumentEntry {
	docId: string;
	meta: DocumentMeta;
	hasStructure: boolean;
	pages: number;
	metaBytes: number;
	structureBytes: number;
	pageBytes: number;
	totalBytes: number;
}

export interface RagIndex {
	generated_at: string;
	documents: DocumentEntry[];
}

// ── 配置 ─────────────────────────────────────────────────────────────────────

// EdgeOne agent-node 打包后 __dirname 指向 .edgeone/agent-node/，
// 无法用相对路径定位源码目录。改用 process.cwd()（项目根）拼接。
const RAG_ROOT: string = process.env.RAG_ROOT
	? path.resolve(process.env.RAG_ROOT)
	: path.join(process.cwd(), "agents", "_data");

// ── 内部工具 ─────────────────────────────────────────────────────────────────

async function readJson<T = unknown>(filePath: string): Promise<T | null> {
	try {
		const raw = await fs.readFile(filePath, "utf-8");
		return JSON.parse(raw) as T;
	} catch (err: any) {
		if (err.code === "ENOENT") return null;
		throw err;
	}
}

/**
 * docId 由 LLM 传入，理论上不可信。
 * 解析后必须落在 RAG_ROOT 内，否则拒绝。
 */
function safeDocDir(docId: string): string {
	if (typeof docId !== "string" || docId.length === 0) {
		throw new Error(`Invalid docId: ${docId}`);
	}
	if (docId === "." || docId === ".." || path.isAbsolute(docId)) {
		throw new Error(`Invalid docId: ${docId}`);
	}
	const resolved = path.resolve(RAG_ROOT, docId);
	const root = path.resolve(RAG_ROOT);
	if (resolved !== root && !resolved.startsWith(root + path.sep)) {
		throw new Error(`docId escapes RAG_ROOT: ${docId}`);
	}
	return resolved;
}

// ── 公共 API ─────────────────────────────────────────────────────────────────

/** 获取文档元信息 */
export async function getDocumentMeta(docId: string): Promise<DocumentMeta | null> {
	const dir = safeDocDir(docId);
	return readJson<DocumentMeta>(path.join(dir, "meta.json"));
}

/** 获取文档树状索引（不含原文，节省 token） */
export async function getDocumentStructure(docId: string): Promise<object | null> {
	const dir = safeDocDir(docId);
	return readJson<object>(path.join(dir, "structure.json"));
}

/** 按页码范围精准拉取原文内容（并行请求） */
export async function getPageContent(docId: string, pages: string | number): Promise<PageContent[]> {
	const dir = safeDocDir(docId);
	const pageNumbers = parsePageRange(pages);
	if (pageNumbers.length === 0) return [];

	return Promise.all(
		pageNumbers.map(async (n): Promise<PageContent> => {
			try {
				const text = await fs.readFile(
					path.join(dir, "pages", `${n}.txt`),
					"utf-8",
				);
				return { page: n, content: text };
			} catch (err: any) {
				if (err.code === "ENOENT") {
					return { page: n, content: "(该页无内容)" };
				}
				throw err;
			}
		}),
	);
}

/** 列出所有已索引文档的 docId 和 meta 信息 */
export async function listDocuments(): Promise<Array<{ docId: string; meta: DocumentMeta }>> {
	const idx = await readJson<RagIndex>(path.join(RAG_ROOT, "index.json"));
	if (!idx?.documents) return [];
	return idx.documents
		.map((d) => ({ docId: d.docId, meta: d.meta }))
		.sort((a, b) => {
			const ta = a.meta?.created ?? "";
			const tb = b.meta?.created ?? "";
			return tb.localeCompare(ta);
		});
}

/** 返回 index.json 的完整内容（供 /api/rag-stats 使用） */
export async function getRagIndex(): Promise<RagIndex | null> {
	return readJson<RagIndex>(path.join(RAG_ROOT, "index.json"));
}

/**
 * 解析页码范围字符串
 * 支持: "5", "5-7", "5-7,12", "5-7, 12, 15-16"
 * 单次最多 20 页，避免滥用。
 */
function parsePageRange(rangeStr: string | number): number[] {
	const pages = new Set<number>();
	const parts = String(rangeStr).split(",");

	for (const part of parts) {
		const trimmed = part.trim();
		if (!trimmed) continue;

		if (trimmed.includes("-")) {
			const [startStr, endStr] = trimmed.split("-");
			const start = parseInt(startStr, 10);
			const end = parseInt(endStr, 10);
			if (!isNaN(start) && !isNaN(end) && start <= end) {
				const safeEnd = Math.min(end, start + 19);
				for (let i = start; i <= safeEnd; i++) {
					pages.add(i);
				}
			}
		} else {
			const n = parseInt(trimmed, 10);
			if (!isNaN(n) && n > 0) pages.add(n);
		}
	}

	return [...pages].sort((a, b) => a - b);
}

export { RAG_ROOT };
