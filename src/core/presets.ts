import raw from "../../survey-presets.json";

// survey-presets.json が正本。ここでは型を付けて、アプリが使う形に正規化するだけ。

export type QuestionId = "scene" | "context" | "good" | "concern";
export const QUESTION_ORDER: QuestionId[] = ["scene", "context", "good", "concern"];

export interface Option {
  id: string;
  label: string;
  exclusive?: boolean;
}

export interface Question {
  id: QuestionId;
  type: "single" | "multi";
  label: string;
  maxSelect: number;
  options: Option[];
}

export interface AiHints {
  avoid?: string[];
  note?: string;
}

export interface Category {
  id: string;
  label: string;
  aiHints?: AiHints;
  questions: Question[];
}

interface RawOption {
  id: string;
  label: string;
  exclusive?: boolean;
}
interface RawQuestion {
  id: string;
  type: string;
  label: string;
  maxSelect?: number;
  options: RawOption[];
}
interface RawCategory {
  id: string;
  label: string;
  aiHints?: AiHints;
  questions: RawQuestion[];
}
export interface RawPresets {
  noneOption: RawOption;
  categories: RawCategory[];
}

export const NONE_ID = "none";

/**
 * プリセットを正規化する。
 * - 設問は scene/context/good/concern の順に揃える
 * - 「特にない」（noneOption）は Q4 の先頭にアプリが付ける。プリセット側には入っていない
 */
export function normalizePresets(presets: RawPresets): Category[] {
  const none: Option = {
    id: presets.noneOption.id,
    label: presets.noneOption.label,
    exclusive: true,
  };
  return presets.categories.map((cat) => {
    const questions = QUESTION_ORDER.map((qid) => {
      const q = cat.questions.find((x) => x.id === qid);
      if (!q) throw new Error(`preset ${cat.id}: question "${qid}" is missing`);
      const type = q.type === "multi" ? "multi" : "single";
      const options: Option[] = q.options
        .filter((o) => o.id !== none.id)
        .map((o) => ({ id: o.id, label: o.label }));
      if (qid === "concern") options.unshift(none);
      return {
        id: qid,
        type,
        label: q.label,
        maxSelect: type === "single" ? 1 : (q.maxSelect ?? options.length),
        options,
      } satisfies Question;
    });
    return { id: cat.id, label: cat.label, aiHints: cat.aiHints, questions };
  });
}

export const CATEGORIES: Category[] = normalizePresets(raw as RawPresets);

export function findCategory(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

/** 回答は選択肢 ID だけで持つ。ラベルは表示・生成の直前に設問定義から引く。 */
export type Answers = Partial<Record<QuestionId, string[]>>;

export interface ResolvedAnswer {
  question: Question;
  options: Option[];
}

/**
 * 回答 ID をラベルへ解決する。存在しない ID は無視し、maxSelect を超えた分は切る。
 * Q4 で「特にない」が選ばれていたら他は捨てる（排他）。
 */
export function resolveAnswers(cat: Category, answers: Answers): Record<QuestionId, ResolvedAnswer> {
  const out = {} as Record<QuestionId, ResolvedAnswer>;
  for (const q of cat.questions) {
    const ids = [...new Set(answers[q.id] ?? [])];
    let options = ids
      .map((id) => q.options.find((o) => o.id === id))
      .filter((o): o is Option => !!o);
    if (options.some((o) => o.exclusive)) options = [];
    else options = options.slice(0, q.maxSelect);
    out[q.id] = { question: q, options };
  }
  return out;
}
