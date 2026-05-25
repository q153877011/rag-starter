/**
 * RAG 工具定义 —— OpenAI Agents SDK 版本。
 *
 * 所有工具从 ./loader.ts 读取 agents/_data 下的本地 RAG 数据，
 * 通过 Agents SDK 的 `tool()` 工厂声明，供 Agent 的 agent loop 调用。
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import {
	getDocumentMeta,
	getDocumentStructure,
	getPageContent,
	listDocuments,
} from "./loader.ts";

// ── RAG 工具 1: 获取文档结构，供 LLM 推理定位 ──────────────────────────────
const searchDocument = tool({
	name: "searchDocument",
	description:
		"搜索知识库文档，获取文档元信息和树状索引结构，用于推理定位相关页码。" +
		"当用户询问知识库相关内容时，优先调用此工具。",
	parameters: z.object({
		query: z.string().describe("用户的搜索问题"),
		docId: z
			.string()
			.nullable()
			.describe("文档ID，传 null 则自动选择第一个可用文档"),
	}),
	async execute({ query, docId }) {
		// 若未指定 docId，自动选第一个可用文档
		if (!docId) {
			const docs = await listDocuments();
			if (docs.length === 0) {
				return {
					error:
						"知识库为空，请先运行 python3 python-script/prepare_rag_data.py 生成文档",
				};
			}
			docId = docs[0].docId;
		}

		const meta = await getDocumentMeta(docId);
		if (!meta) {
			return { error: `文档 ${docId} 不存在，请检查文档 ID` };
		}

		const structure = await getDocumentStructure(docId);

		return {
			docId,
			query,
			meta,
			structure,
			instruction:
				"请仔细分析以上文档结构（structure），找出与用户问题最相关的章节，" +
				"确定对应的页码范围（start_index 到 end_index），" +
				"然后调用 fetchPages 工具获取该页码范围的原文内容，再基于原文回答用户问题。",
		};
	},
});

// ── RAG 工具 2: LLM 推理定位后精准拉取原文 ────────────────────────────────
const fetchPages = tool({
	name: "fetchPages",
	description:
		"根据页码范围获取文档原文内容。在 searchDocument 定位到相关章节后调用此工具获取原文。",
	parameters: z.object({
		docId: z.string().describe("文档ID"),
		pages: z
			.string()
			.describe(
				"页码范围，支持格式: '5' / '5-7' / '5-7,12' / '5-7,12,15-16'，单次最多 20 页",
			),
	}),
	async execute({ docId, pages }) {
		const content = await getPageContent(docId, pages);
		if (content.length === 0) {
			return { error: "未找到指定页面，请检查页码范围是否正确" };
		}

		// 获取文档名称
		const meta = await getDocumentMeta(docId);
		const docName = meta?.doc_name ?? docId;

		const totalChars = content.reduce((sum, p) => sum + p.content.length, 0);

		return {
			type: "citation_pages",
			docId,
			docName,
			pages,
			pageCount: content.length,
			totalChars,
			content: content.map((p) => ({
				page: p.page,
				content: p.content,
				preview: p.content.slice(0, 400),
			})),
		};
	},
});

// ── 原有辅助工具 ────────────────────────────────────────────────────────────
const getWeather = tool({
	name: "getWeather",
	description: "Get the current weather for a city",
	parameters: z.object({
		city: z.string().describe("City name"),
	}),
	async execute({ city }) {
		const conditions = ["sunny", "cloudy", "rainy"];
		const temp = Math.floor(Math.random() * 30) + 5;
		return {
			city,
			temperature: temp,
			condition: conditions[Math.floor(Math.random() * conditions.length)],
		};
	},
});

const getUserTimezone = tool({
	name: "getUserTimezone",
	description:
		"Get the server's current timezone and local time.",
	parameters: z.object({}),
	async execute() {
		return {
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			localTime: new Date().toLocaleTimeString(),
		};
	},
});

const calculate = tool({
	name: "calculate",
	description: "Perform a math calculation with two numbers.",
	parameters: z.object({
		a: z.number().describe("First number"),
		b: z.number().describe("Second number"),
		operator: z
			.enum(["+", "-", "*", "/", "%"])
			.describe("Arithmetic operator"),
	}),
	async execute({ a, b, operator }) {
		const ops: Record<string, (x: number, y: number) => number> = {
			"+": (x, y) => x + y,
			"-": (x, y) => x - y,
			"*": (x, y) => x * y,
			"/": (x, y) => x / y,
			"%": (x, y) => x % y,
		};
		if (operator === "/" && b === 0) {
			return { error: "Division by zero" };
		}
		return {
			expression: `${a} ${operator} ${b}`,
			result: ops[operator](a, b),
		};
	},
});

/** 返回 RAG 场景下的全部工具（给 Agent 构造时传入 tools 字段）。 */
export function buildRagTools() {
	return [searchDocument, fetchPages, getWeather, getUserTimezone, calculate];
}
