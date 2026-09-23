/// <reference types="vitest/config" />
import { resolve } from "node:path";
import { defineConfig } from "vite";

// GitHub Pages はサブパス配信（https://<user>.github.io/<repo>/）になる。
// base を合わせないとアセットが 404 になり真っ白になるので、
// BASE_PATH > GITHUB_REPOSITORY（Actions が自動で入れる）> "/" の順で決める。
function resolveBase(): string {
  if (process.env.BASE_PATH) return process.env.BASE_PATH;
  const repo = process.env.GITHUB_REPOSITORY?.split("/")[1];
  return repo ? `/${repo}/` : "/";
}

export default defineConfig({
  base: resolveBase(),
  build: {
    // お客さま用ページ（/）と管理者ページ（/admin/）
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        admin: resolve(import.meta.dirname, "admin/index.html"),
      },
    },
  },
  test: {
    include: process.env.SAMPLES ? ["scripts/**/*.test.ts"] : ["src/**/*.test.ts"],
  },
});
