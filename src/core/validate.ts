// 出力の検証（テンプレート・Claude 両モード共通）

export const MIN_LEN = 80;
export const MAX_LEN = 250;
export const PREFIX_LEN = 30;

export const BANNED_WORDS = ["最高", "絶対", "No.1", "No1", "ナンバーワン", "日本一", "世界一", "必ず", "間違いなし", "まちがいなし"];
const MONEY = /[¥￥円]|\d+\s*(?:yen|YEN)/;
const EMOJI = /\p{Extended_Pictographic}/u;

export const prefixOf = (text: string) => text.replace(/\s+/g, "").slice(0, PREFIX_LEN);

export interface ValidateOptions {
  /** 業種ごとの避ける表現（aiHints.avoid） */
  avoid?: string[];
  /** 直近の生成文と、同じ回で先に採用した案 */
  history?: string[];
}

/** 問題が無ければ null、あれば理由 */
export function validateDraft(text: string, opts: ValidateOptions = {}): string | null {
  const t = text.trim();
  const len = [...t].length;
  if (len < MIN_LEN) return `too_short:${len}`;
  if (len > MAX_LEN) return `too_long:${len}`;
  const lower = t.toLowerCase();
  for (const w of [...BANNED_WORDS, ...(opts.avoid ?? [])]) {
    if (lower.includes(w.toLowerCase())) return `banned:${w}`;
  }
  if (MONEY.test(t)) return "money";
  if (EMOJI.test(t)) return "emoji";
  if (/私は/.test(t)) return "first_person";
  const p = prefixOf(t);
  if ((opts.history ?? []).some((h) => prefixOf(h) === p)) return "duplicate_prefix";
  return null;
}
