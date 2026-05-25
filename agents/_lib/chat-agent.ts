/**
 * Chat handler — 基于 OpenAI Agents SDK 的无状态实现。
 */

import { Agent, run } from "@openai/agents";

import { buildRagTools } from "./tools.ts";
import { getModel } from "./_model.ts";

// ── 类型定义 ────────────────────────────────────────────────────────────────

interface UIMessagePart {
	type: string;
	text?: string;
	[key: string]: unknown;
}

interface UIMessage {
	role: string;
	parts?: UIMessagePart[];
	[key: string]: unknown;
}

interface StreamChatParams {
	messages: UIMessage[];
	withRag: boolean;
}

interface StreamChatResult {
	pipeUIMessageStreamToResponse(res: any): void;
	toUIMessageStream(): ReadableStream;
}

// ── 系统提示 ────────────────────────────────────────────────────────────────
const RAG_SYSTEM =
	"You are an enterprise knowledge base assistant. " +
	"When the user asks a question, you MUST follow these steps:\n" +
	"1. Call searchDocument to find relevant documents in the knowledge base.\n" +
	"2. Call fetchPages to retrieve the exact page content.\n" +
	"3. Answer the question based ONLY on the retrieved content.\n" +
	"4. Always cite the source document name and page numbers in your answer (e.g. 根据《xxx》第 N 页...).\n" +
	"5. If the knowledge base does not contain relevant information, clearly state: 知识库中未找到相关信息。\n\n" +
	"请用中文回答用户问题。引用文档时请注明来源页码。";

const DIRECT_SYSTEM =
	"You are a helpful assistant. Answer questions based solely on your own knowledge. " +
	"Do NOT use any external tools or knowledge base. " +
	"请用中文回答用户问题。如果你不确定某些具体数据，请直接说明你没有相关信息。";

// ── Agent 定义（懒加载 + 单例） ─────────────────────────────────────────────
let ragAgent: InstanceType<typeof Agent> | null = null;
let directAgent: InstanceType<typeof Agent> | null = null;

function getRagAgent() {
	if (!ragAgent) {
		ragAgent = new Agent({
			name: "RAG Assistant",
			instructions: RAG_SYSTEM,
			model: getModel(),
			tools: buildRagTools(),
		});
	}
	return ragAgent;
}

function getDirectAgent() {
	if (!directAgent) {
		directAgent = new Agent({
			name: "Direct Assistant",
			instructions: DIRECT_SYSTEM,
			model: getModel(),
		});
	}
	return directAgent;
}

// ── UIMessage[] → Agents SDK AgentInputItem[] ─────────────────────────────

function uiMessagesToAgentsInput(uiMessages: UIMessage[]) {
	const items: any[] = [];
	for (const msg of uiMessages ?? []) {
		const parts = Array.isArray(msg?.parts) ? msg.parts : [];

		if (msg.role === "user") {
			const content = parts
				.filter((p) => p?.type === "text" && typeof p.text === "string")
				.map((p) => ({ type: "input_text" as const, text: p.text! }));
			if (content.length) items.push({ role: "user", content });
			continue;
		}

		if (msg.role === "assistant") {
			const content = parts
				.filter((p) => p?.type === "text" && typeof p.text === "string")
				.map((p) => ({ type: "output_text" as const, text: p.text! }));
			if (content.length) {
				items.push({ role: "assistant", content, status: "completed" });
			}
			continue;
		}
	}
	return items;
}

// ── RunStreamEvent → UIMessageChunk 流 ──────────────────────────────────
const genId = (prefix: string): string =>
	`${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function runResultToUIMessageStream(runResult: any): ReadableStream {
	const messageId = genId("msg");
	const rawStream = runResult.toStream();
	const reader = rawStream.getReader();

	let started = false;
	let currentTextId: string | null = null;

	function openTextSegment(controller: ReadableStreamDefaultController) {
		if (currentTextId) return;
		currentTextId = genId("txt");
		controller.enqueue({ type: "text-start", id: currentTextId });
	}

	function closeTextSegment(controller: ReadableStreamDefaultController) {
		if (!currentTextId) return;
		controller.enqueue({ type: "text-end", id: currentTextId });
		currentTextId = null;
	}

	return new ReadableStream({
		async pull(controller) {
			try {
				if (!started) {
					started = true;
					controller.enqueue({ type: "start", messageId });
				}

				while (true) {
					const { done, value: event } = await reader.read();

					if (done) {
						closeTextSegment(controller);
						controller.enqueue({ type: "finish" });
						controller.close();
						return;
					}

					// 文本增量
					if (
						event?.type === "raw_model_stream_event" &&
						event.data?.type === "output_text_delta"
					) {
						const delta = event.data.delta;
						if (typeof delta === "string" && delta.length > 0) {
							openTextSegment(controller);
							controller.enqueue({
								type: "text-delta",
								id: currentTextId,
								delta,
							});
							return;
						}
						continue;
					}

					// 工具调用 / 工具输出
					if (event?.type === "run_item_stream_event") {
						const { name, item } = event;

						if (name === "tool_called" && item?.type === "tool_call_item") {
							const raw = item.rawItem;
							if (raw?.type === "function_call") {
								closeTextSegment(controller);

								let parsedInput: any = {};
								try {
									parsedInput = raw.arguments ? JSON.parse(raw.arguments) : {};
								} catch {
									parsedInput = { _raw: raw.arguments };
								}

								controller.enqueue({
									type: "tool-input-available",
									toolCallId: raw.callId,
									toolName: raw.name,
									input: parsedInput,
								});
								return;
							}
						}

						if (
							name === "tool_output" &&
							item?.type === "tool_call_output_item"
						) {
							const raw = item.rawItem;
							controller.enqueue({
								type: "tool-output-available",
								toolCallId: raw?.callId,
								output: item.output,
							});
							return;
						}
					}
				}
			} catch (err: any) {
				try {
					closeTextSegment(controller);
					controller.enqueue({
						type: "error",
						errorText: err?.message ?? String(err),
					});
				} catch { /* ignore */ }
				controller.error(err);
			}
		},

		cancel(reason) {
			reader.cancel(reason).catch(() => {});
		},
	});
}

/**
 * 启动一次流式对话。
 */
export async function streamChat({ messages, withRag }: StreamChatParams): Promise<StreamChatResult> {
	const input = uiMessagesToAgentsInput(messages);
	if (input.length === 0) {
		throw new Error("messages 中没有可用的文本内容");
	}

	const agent = withRag ? getRagAgent() : getDirectAgent();

	const runResult = await run(agent, input, {
		stream: true,
		maxTurns: withRag ? 6 : 2,
	});

	const uiStream = runResultToUIMessageStream(runResult);

	return {
		pipeUIMessageStreamToResponse(_res: any) {
			// Legacy Express compat — not used in EdgeOne pattern
		},
		toUIMessageStream: () => uiStream,
	};
}
