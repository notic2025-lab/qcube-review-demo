// 全業種 × 数パターンの生成結果を目で確認するためのスクリプト（npm run samples）
import { test } from "vitest";
import { CATEGORIES } from "../src/core/presets";
import type { Answers, Category } from "../src/core/presets";
import { generateTemplateDrafts } from "../src/core/generate";
import { pick, seededRng, shuffle } from "../src/core/rng";

const PER_CATEGORY = Number(process.env.PER ?? 3);
const ONLY = process.env.CAT;

function randomAnswers(cat: Category, r: () => number): Answers {
  const [scene, context, good, concern] = cat.questions;
  const g = shuffle(r, good.options).slice(0, 1 + Math.floor(r() * 3)).map((o) => o.id);
  const nc = Math.floor(r() * 3);
  const c = nc === 0 ? ["none"] : shuffle(r, concern.options.filter((o) => !o.exclusive)).slice(0, nc).map((o) => o.id);
  return { scene: [pick(r, scene.options).id], context: [pick(r, context.options).id], good: g, concern: c };
}

test("samples", () => {
  const r = seededRng(Number(process.env.SEED ?? Date.now() % 100000));
  const lines: string[] = [];
  for (const cat of CATEGORIES) {
    if (ONLY && cat.id !== ONLY) continue;
    for (let i = 0; i < PER_CATEGORY; i++) {
      const a = randomAnswers(cat, r);
      const label = (qi: number, ids: string[] = []) => ids.map((id) => cat.questions[qi].options.find((o) => o.id === id)?.label).join("・");
      lines.push(`\n■ ${cat.label} ｜ ${label(0, a.scene)} / ${label(1, a.context)} / 良:${label(2, a.good)} / 気:${label(3, a.concern)}`);
      for (const d of generateTemplateDrafts(cat, a, { rng: r })) lines.push(`  [${d.seed}] (${[...d.text].length}) ${d.text}`);
    }
  }
  process.stdout.write(lines.join("\n") + "\n");
});
