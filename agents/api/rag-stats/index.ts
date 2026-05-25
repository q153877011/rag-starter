/**
 * GET /api/rag-stats — RAG 数据统计
 */
import { getRagIndex } from "../../_lib/loader.ts";
import { createLogger } from "../../_lib/logger.ts";

const logger = createLogger("api/rag-stats");

export async function onRequest(_context: any) {
  try {
    const idx = await getRagIndex();
    const docs = idx?.documents ?? [];

    const totalBytes = docs.reduce((s, d) => s + (d.totalBytes ?? 0), 0);
    const totalEntries = docs.reduce(
      (s, d) => s + 1 + (d.hasStructure ? 1 : 0) + (d.pages ?? 0),
      0,
    );

    const body = {
      total: totalEntries,
      totalBytes,
      documents: docs.map((d) => ({
        docId: d.docId,
        meta: 1,
        structure: d.hasStructure ? 1 : 0,
        pages: d.pages ?? 0,
        total: 1 + (d.hasStructure ? 1 : 0) + (d.pages ?? 0),
        metaBytes: d.metaBytes ?? 0,
        structureBytes: d.structureBytes ?? 0,
        pageBytes: d.pageBytes ?? 0,
        totalBytes: d.totalBytes ?? 0,
      })),
    };

    logger.log("返回统计:", docs.length, "篇文档,", totalEntries, "条目");
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    logger.error("获取 RAG 统计失败:", err?.message || err, err?.stack);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
