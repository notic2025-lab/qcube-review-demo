import type { Draft } from "./generate";
import { generateTemplateDrafts } from "./generate";
import type { Answers, Category } from "./presets";
import type { Settings } from "./storage";

export type EngineResult = { drafts: Draft[]; mode: "template" | "claude"; fallbackReason?: string };

/** 下書きを作る。既定はテンプレートモード */
export async function generateDrafts(cat: Category, answers: Answers, _settings: Settings, history: string[]): Promise<EngineResult> {
  return { drafts: generateTemplateDrafts(cat, answers, { history }), mode: "template" };
}
