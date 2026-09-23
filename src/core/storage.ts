// 量産防止の履歴と管理者ページの編集中の設定。すべてこの端末の localStorage にだけ置く。
// プライベートブラウズ等で localStorage が使えなくても画面は動くようにする。

const HISTORY_KEY = "qrd.history.v1";
export const HISTORY_SIZE = 20;

export function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 保存できなくても続行する
  }
}

export function loadHistory(): string[] {
  const h = read<unknown>(HISTORY_KEY, []);
  return Array.isArray(h) ? h.filter((x): x is string => typeof x === "string").slice(0, HISTORY_SIZE) : [];
}

export function pushHistory(texts: string[]): void {
  write(HISTORY_KEY, [...texts, ...loadHistory()].slice(0, HISTORY_SIZE));
}

export function clearHistory(): void {
  write(HISTORY_KEY, []);
}

// Claude モードの設定。API キーはこの端末の localStorage にだけ置く（URL・リポジトリ・ログに出さない）
const AI_KEY = "qrd.ai.v1";

export interface AiSettings {
  enabled: boolean;
  apiKey: string;
}

export function loadAiSettings(): AiSettings {
  const s = read<Partial<AiSettings>>(AI_KEY, {});
  return { enabled: s.enabled === true, apiKey: typeof s.apiKey === "string" ? s.apiKey : "" };
}

export function saveAiSettings(s: AiSettings): void {
  write(AI_KEY, s);
}
