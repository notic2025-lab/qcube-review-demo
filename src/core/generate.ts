import type { Answers, Category } from "./presets";
import type { Rng } from "./rng";
import { shuffle } from "./rng";
import type { SeedId } from "./seeds";
import { SEED_IDS } from "./seeds";
import { buildCtx, renderSeed } from "./template";
import { validateDraft } from "./validate";

export interface Draft {
  seed: SeedId;
  text: string;
}

export interface GenerateOptions {
  rng?: Rng;
  /** 直近の生成文（量産防止） */
  history?: string[];
  count?: number;
}

const TRIES_PER_SEED = 8;

/**
 * テンプレートモードで下書きを作る。語り口シードを重複なく選び、検証に落ちた案は作り直す。
 * どうしても通らないシードは飛ばして次のシードへ。
 */
export function generateTemplateDrafts(cat: Category, answers: Answers, opts: GenerateOptions = {}): Draft[] {
  const r = opts.rng ?? Math.random;
  const count = opts.count ?? 3;
  const history = [...(opts.history ?? [])];
  const avoid = cat.aiHints?.avoid ?? [];
  const out: Draft[] = [];
  let fallback: Draft | undefined;
  for (const seed of shuffle(r, SEED_IDS)) {
    if (out.length >= count) break;
    for (let i = 0; i < TRIES_PER_SEED; i++) {
      const text = renderSeed(seed, buildCtx(cat, answers, r));
      const err = validateDraft(text, { avoid, history: [...history, ...out.map((d) => d.text)] });
      if (!err) {
        out.push({ seed, text });
        break;
      }
      if (!fallback && err === "duplicate_prefix") fallback = { seed, text };
    }
  }
  // 履歴と重なり続けても画面は止めない
  while (out.length < count && fallback) {
    out.push(fallback);
    fallback = undefined;
  }
  return out;
}
