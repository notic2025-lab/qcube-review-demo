import { ClaudeError, generateClaudeDrafts } from "./claude";
import type { Draft } from "./generate";
import { generateTemplateDrafts } from "./generate";
import type { Answers, Category } from "./presets";
import { loadAiSettings } from "./storage";

export interface EngineResult {
  drafts: Draft[];
  mode: "template" | "claude";
  /** Claude を使おうとして失敗し、テンプレートにしたときの理由 */
  fallbackReason?: string;
}

/**
 * 下書きを作る。この端末で Claude モードが有効ならまず Claude、失敗したらテンプレートに切り替える（画面は止めない）。
 * Claude の案が3つそろわなかった分もテンプレートで補う。
 */
export async function generateDrafts(cat: Category, answers: Answers, history: string[], storeName: string): Promise<EngineResult> {
  const ai = loadAiSettings();
  if (ai.enabled && ai.apiKey) {
    try {
      const drafts = await generateClaudeDrafts(cat, answers, { apiKey: ai.apiKey, storeName, history });
      if (drafts.length < 3) {
        const more = generateTemplateDrafts(cat, answers, { history: [...history, ...drafts.map((d) => d.text)], count: 3 - drafts.length });
        drafts.push(...more);
      }
      return { drafts, mode: "claude" };
    } catch (e) {
      const reason = e instanceof ClaudeError ? e.message : "Claude で作れませんでした";
      return { drafts: generateTemplateDrafts(cat, answers, { history }), mode: "template", fallbackReason: reason };
    }
  }
  return { drafts: generateTemplateDrafts(cat, answers, { history }), mode: "template" };
}
