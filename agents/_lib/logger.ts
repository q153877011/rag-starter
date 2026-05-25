/**
 * 共享日志工具 — 私有模块（_ 开头不映射路由）
 *
 * 参考 EdgeOne Pages 约定，格式化日志输出。
 */

export interface Logger {
	log(...args: unknown[]): void;
	error(...args: unknown[]): void;
	warn(...args: unknown[]): void;
}

/**
 * 创建带标签的 logger
 */
export function createLogger(tag: string): Logger {
	function ts(): string {
		return new Date().toISOString();
	}

	return {
		log(...args: unknown[]) {
			console.log(`[${tag}][${ts()}]`, ...args);
		},
		error(...args: unknown[]) {
			console.error(`[${tag}][${ts()}]`, ...args);
		},
		warn(...args: unknown[]) {
			console.warn(`[${tag}][${ts()}]`, ...args);
		},
	};
}
