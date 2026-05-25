/**
 * POST /api/chat/rag — 带 RAG 工具的 LLM 流式对话
 */
import { streamChat } from "../../../_lib/chat-agent.ts";
import { createLogger } from "../../../_lib/logger.ts";

const logger = createLogger("api/chat/rag");

export async function onRequest(context: any) {
  const { request } = context;
  const body = request.body;

  const messages = body?.messages;
  if (!Array.isArray(messages)) {
    logger.error("请求体缺少 messages 数组", body);
    return new Response(JSON.stringify({ error: "请求体缺少 messages 数组" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    logger.log("开始 RAG 流式对话, messages:", messages.length);
    const result = await streamChat({ messages, withRag: true });
    const uiStream = result.toUIMessageStream();
    const reader = uiStream.getReader();

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
        } catch (err: any) {
          logger.error("流式输出异常:", err?.message || err, err?.stack);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", errorText: `[RAG] ${err?.message || "stream error"}` })}\n\n`)
          );
          controller.close();
        }
      },
      cancel() {
        reader.cancel().catch(() => {});
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "x-vercel-ai-ui-message-stream": "v1",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err: any) {
    logger.error("streamChat 启动失败:", err?.message || err, err?.stack);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
