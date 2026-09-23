/// <reference types="vitest/config" />
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
  test: {
    include: process.env.SAMPLES ? ["scripts/**/*.test.ts"] : ["src/**/*.test.ts"],
  },
});
