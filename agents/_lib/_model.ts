/**
 * 私有模块（_ 开头不映射路由）— LLM 模型配置
 *
 * 通过环境变量配置: AI_GATE_API_KEY / AI_GATE_BASE_URL / AI_GATE_MODEL
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { aisdk } from "@openai/agents-extensions";
import { createLogger } from "./logger.ts";

const logger = createLogger("model");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedModel: any;

export function getModel() {
	if (cachedModel) return cachedModel;

	const apiKey = process.env.AI_GATE_API_KEY;
	const baseURL = process.env.AI_GATE_BASE_URL;
	const modelName = process.env.AI_GATE_MODEL;

	if (!apiKey || !baseURL || !modelName) {
		const msg = "AI_GATE_API_KEY / AI_GATE_BASE_URL / AI_GATE_MODEL 未设置，请检查 .env 文件。";
		logger.error(msg);
		throw new Error(msg);
	}

	logger.log(`初始化模型: ${modelName} @ ${baseURL}`);

	const gateway = createOpenAICompatible({
		name: "ai-gateway",
		baseURL,
		apiKey,
	});

	// GLM-5 等推理模型的 finish chunk 里 usage.inputTokens / outputTokens
	// 是对象（如 {total:6,noCache:6,...}），而 @openai/agents-core 的 Zod
	// 校验要求它们是数字，否则崩溃。用 Proxy 拦截 doStream，在 finish
	// chunk 出来时把 usage 数字化。
	const rawModel = gateway.chatModel(modelName);
	const patchedModel = new Proxy(rawModel, {
		get(target, prop) {
			if (prop !== "doStream") return Reflect.get(target, prop);
			return async function patchedDoStream(...args: unknown[]) {
				const result = await (target as any).doStream(...args);
				const patchedStream = result.stream.pipeThrough(
					new TransformStream({
						transform(chunk: any, controller: TransformStreamDefaultController) {
							if (chunk.type === "finish" && chunk.usage) {
								const toNum = (v: unknown): number =>
									typeof v === "object" && v !== null
										? Number((v as any).total ?? (v as any).promptTokens ?? 0) || 0
										: Number(v) || 0;
								chunk = {
									...chunk,
									usage: {
										inputTokens: toNum(chunk.usage.inputTokens),
										outputTokens: toNum(chunk.usage.outputTokens),
									},
								};
							}
							controller.enqueue(chunk);
						},
					}),
				);
				return { ...result, stream: patchedStream };
			};
		},
	});

	// 通过 aisdk 适配器把 Vercel AI SDK 的 LanguageModel 交给 Agents SDK
	cachedModel = aisdk(patchedModel as any);
	return cachedModel;
}
