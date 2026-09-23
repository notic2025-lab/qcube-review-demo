import { isValidPlaceId } from "./destination";
import type { Category, Option, QuestionId } from "./presets";
import { CATEGORIES, NONE_ID, QUESTION_ORDER, findCategory } from "./presets";
import { read, write } from "./storage";
import { BANNED_WORDS } from "./validate";

// 管理者ページとお客さま用ページをつなぐ「店舗設定」。
// サーバーも DB も無いので、設定はお客さま用URLのハッシュ（#s=...）に入れて渡す。
// URL はだれでも書き換えられるので、読み込むときは必ず検査・無害化する。

export interface EditOption {
  /** プリセットの選択肢 ID。管理者が足した選択肢には無い */
  presetId?: string;
  label: string;
}

export interface EditQuestion {
  label: string;
  /** Q4 の「特にない」は含めない（アプリが自動で先頭に付ける） */
  options: EditOption[];
}

export interface StoreDraft {
  cat: string;
  name: string;
  placeId: string;
  questions: Record<QuestionId, EditQuestion>;
}

export const LIMITS = {
  name: 40,
  questionLabel: 40,
  optionLabel: 30,
  min: { scene: 2, context: 2, good: 3, concern: 2 } as Record<QuestionId, number>,
  max: { scene: 8, context: 8, good: 14, concern: 10 } as Record<QuestionId, number>,
};

/** 満足度・星評価を聞く設問は作らない（レビューゲーティングにつながるため） */
const RATING_WORDS = /満足度|星|★|☆|評価|点数|何点|採点|ランク/;
const MONEY = /[¥￥円]/;
const CONTROL = /[\u0000-\u001f\u007f]/g;

const clean = (s: unknown, max: number) =>
  typeof s === "string" ? [...s.replace(CONTROL, "").trim()].slice(0, max).join("") : "";

function presetCategory(catId: string): Category {
  const c = findCategory(catId);
  if (!c) throw new Error(`unknown category: ${catId}`);
  return c;
}

/** プリセットそのままの店舗設定 */
export function draftFromPreset(catId: string, name = ""): StoreDraft {
  const cat = presetCategory(catId);
  const questions = {} as Record<QuestionId, EditQuestion>;
  for (const q of cat.questions) {
    questions[q.id] = {
      label: q.label,
      options: q.options.filter((o) => o.id !== NONE_ID).map((o) => ({ presetId: o.id, label: o.label })),
    };
  }
  return { cat: cat.id, name, placeId: "", questions };
}

export function resetQuestion(d: StoreDraft, qid: QuestionId): StoreDraft {
  return { ...d, questions: { ...d.questions, [qid]: draftFromPreset(d.cat).questions[qid] } };
}

export function isQuestionEdited(d: StoreDraft, qid: QuestionId): boolean {
  const base = draftFromPreset(d.cat).questions[qid];
  const cur = d.questions[qid];
  return (
    cur.label !== base.label ||
    cur.options.length !== base.options.length ||
    cur.options.some((o, i) => o.presetId !== base.options[i].presetId || o.label !== base.options[i].label)
  );
}

// ---- 検査 -------------------------------------------------------------------

export interface Issue {
  /** 例: "name", "placeId", "good.label", "good.options.2" */
  path: string;
  message: string;
  /** error はURLを発行しない。warn は発行する */
  level: "error" | "warn";
}

function bannedIn(s: string): string | undefined {
  return BANNED_WORDS.find((w) => s.toLowerCase().includes(w.toLowerCase()));
}

export function checkStore(d: StoreDraft): Issue[] {
  const out: Issue[] = [];
  const err = (path: string, message: string) => out.push({ path, message, level: "error" });
  if (!findCategory(d.cat)) err("cat", "業種を選んでください");
  if (!d.name.trim()) err("name", "店名を入れてください");
  const pid = d.placeId.trim();
  if (pid && !isValidPlaceId(pid)) {
    out.push({ path: "placeId", message: "Place ID の形式ではありません。このままだとGoogleマップのトップが開きます", level: "warn" });
  }
  for (const qid of QUESTION_ORDER) {
    const q = d.questions[qid];
    if (!q.label.trim()) err(`${qid}.label`, "質問文を入れてください");
    else if (RATING_WORDS.test(q.label)) {
      err(`${qid}.label`, "満足度や星の数を聞く質問は作れません（評価で案内を分けることにつながるため）");
    }
    if (q.options.length < LIMITS.min[qid]) err(`${qid}.options`, `選択肢は${LIMITS.min[qid]}つ以上にしてください`);
    if (q.options.length > LIMITS.max[qid]) err(`${qid}.options`, `選択肢は${LIMITS.max[qid]}個までです`);
    const seen = new Set<string>();
    q.options.forEach((o, i) => {
      const label = o.label.trim();
      const path = `${qid}.options.${i}`;
      if (!label) return err(path, "選択肢が空です");
      if (seen.has(label)) err(path, "同じ選択肢が2つあります");
      seen.add(label);
      const b = bannedIn(label);
      if (b) err(path, `「${b}」は口コミに入れられない表現なので使えません`);
      if (MONEY.test(label)) err(path, "金額は選択肢に入れられません");
    });
  }
  return out;
}

// ---- 業種定義へ適用 -----------------------------------------------------------

/** 店舗設定をアンケート定義にする。名前を変えた・足した選択肢は、ラベルから文章を作る */
export function toCategory(d: StoreDraft): Category {
  const base = presetCategory(d.cat);
  const none = base.questions[3].options.find((o) => o.id === NONE_ID)!;
  return {
    ...base,
    questions: base.questions.map((bq) => {
      const eq = d.questions[bq.id];
      let custom = 0;
      const options: Option[] = eq.options.map((o) => {
        const preset = o.presetId ? bq.options.find((p) => p.id === o.presetId) : undefined;
        if (preset) return preset.label === o.label ? { id: preset.id, label: o.label } : { id: preset.id, label: o.label, useLabel: true };
        custom += 1;
        return { id: `x${custom}`, label: o.label, useLabel: true };
      });
      if (bq.id === "concern") options.unshift(none);
      return { ...bq, label: eq.label, options };
    }),
  };
}

// ---- URL との相互変換 ----------------------------------------------------------

type PayloadOption = string | [string, string];
interface PayloadQuestion {
  l?: string;
  o?: PayloadOption[];
}
interface Payload {
  v: 1;
  c: string;
  n: string;
  p?: string;
  q?: Partial<Record<QuestionId, PayloadQuestion>>;
}

/** プリセットとの差分だけを持つ（URL を短くするため） */
export function toPayload(d: StoreDraft): Payload {
  const base = draftFromPreset(d.cat);
  const p: Payload = { v: 1, c: d.cat, n: d.name.trim() };
  if (d.placeId.trim()) p.p = d.placeId.trim();
  for (const qid of QUESTION_ORDER) {
    if (!isQuestionEdited(d, qid)) continue;
    const cur = d.questions[qid];
    const pq: PayloadQuestion = {};
    if (cur.label !== base.questions[qid].label) pq.l = cur.label;
    const baseLabels = new Map(base.questions[qid].options.map((o) => [o.presetId!, o.label]));
    pq.o = cur.options.map((o) =>
      o.presetId && baseLabels.get(o.presetId) === o.label ? o.presetId : [o.presetId ?? "", o.label],
    );
    (p.q ??= {})[qid] = pq;
  }
  return p;
}

/** URL から来た値を検査して店舗設定にする。直せない部分はプリセットに戻す */
export function fromPayload(raw: unknown): StoreDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<Payload>;
  if (p.v !== 1 || typeof p.c !== "string" || !findCategory(p.c)) return null;
  const d = draftFromPreset(p.c, clean(p.n, LIMITS.name));
  const pid = clean(p.p, 200);
  d.placeId = isValidPlaceId(pid) ? pid : "";
  const qs = p.q && typeof p.q === "object" ? p.q : {};
  for (const qid of QUESTION_ORDER) {
    const pq = (qs as Record<string, unknown>)[qid] as PayloadQuestion | undefined;
    if (!pq || typeof pq !== "object") continue;
    const base = d.questions[qid];
    const label = clean(pq.l, LIMITS.questionLabel);
    if (label && !RATING_WORDS.test(label)) base.label = label;
    if (!Array.isArray(pq.o)) continue;
    const presetLabels = new Map(base.options.map((o) => [o.presetId!, o.label]));
    const used = new Set<string>();
    const options: EditOption[] = [];
    for (const e of pq.o.slice(0, LIMITS.max[qid])) {
      let presetId: string | undefined;
      let optLabel: string;
      if (typeof e === "string") {
        presetId = e;
        optLabel = presetLabels.get(e) ?? "";
      } else if (Array.isArray(e) && e.length === 2) {
        presetId = typeof e[0] === "string" && presetLabels.has(e[0]) ? e[0] : undefined;
        optLabel = clean(e[1], LIMITS.optionLabel);
      } else continue;
      if (presetId && !presetLabels.has(presetId)) presetId = undefined;
      if (!optLabel || used.has(optLabel) || (presetId && used.has(`#${presetId}`))) continue;
      if (bannedIn(optLabel) || MONEY.test(optLabel)) continue;
      used.add(optLabel);
      if (presetId) used.add(`#${presetId}`);
      options.push(presetId ? { presetId, label: optLabel } : { label: optLabel });
    }
    if (options.length >= LIMITS.min[qid]) base.options = options;
  }
  return d;
}

// base64url
function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

const MAX_TOKEN = 6000;

/** 店舗設定 → URL に入れる文字列。先頭1文字で形式を表す（z: 圧縮, j: 無圧縮） */
export async function encodeStore(d: StoreDraft): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(toPayload(d)));
  if (typeof CompressionStream === "function") {
    return "z" + toB64(await pipe(json, new CompressionStream("deflate-raw")));
  }
  return "j" + toB64(json);
}

export async function decodeStore(token: string): Promise<StoreDraft | null> {
  if (!token || token.length > MAX_TOKEN) return null;
  try {
    const kind = token[0];
    let bytes = fromB64(token.slice(1));
    if (kind === "z") bytes = await pipe(bytes, new DecompressionStream("deflate-raw"));
    else if (kind !== "j") return null;
    return fromPayload(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

/** お客さま用URL */
export function storeUrl(customerBase: string, token: string): string {
  const u = new URL(customerBase);
  u.hash = `s=${token}`;
  return u.toString();
}

export function tokenFromHash(hash: string): string | null {
  const m = /^#s=([A-Za-z0-9_-]+)$/.exec(hash);
  return m ? m[1] : null;
}

export const DEFAULT_CATEGORY = CATEGORIES[0].id;

// 管理者ページで編集中の設定（この端末の localStorage）
const SAVED_KEY = "qrd.admin.v1";

/** 保存されていた設定。URL と同じ検査を通してから返す */
export function loadSavedStore(): StoreDraft | null {
  const saved = read<StoreDraft | null>(SAVED_KEY, null);
  if (!saved) return null;
  try {
    return fromPayload(toPayload(saved));
  } catch {
    return null;
  }
}

export function saveStore(d: StoreDraft): void {
  write(SAVED_KEY, d);
}
