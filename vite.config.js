import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
	plugins: [react()],
	// 不使用 public/ 静态目录（prepare-rag 脚本不需要暴露给前端）
	publicDir: false,
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
});
