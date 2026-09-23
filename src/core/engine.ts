import type { Draft } from "./generate";
import { generateTemplateDrafts } from "./generate";
import type { Answers, Category } from "./presets";

export type EngineResult = { drafts: Draft[]; mode: "template" };

/** 下書きを作る。いまはテンプレートモードのみ（API なし） */
export async function generateDrafts(cat: Category, answers: Answers, history: string[]): Promise<EngineResult> {
  return { drafts: generateTemplateDrafts(cat, answers, { history }), mode: "template" };
}
