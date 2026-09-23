import type { Answers, Category, Option } from "./presets";
import { resolveAnswers } from "./presets";
import type { CategoryPhrases, ConcernPhrase, ContextPhrase, GoodPhrase, ScenePhrase } from "./phrases";
import { PHRASES } from "./phrases";
import type { Rng } from "./rng";
import { pick } from "./rng";
import type { SeedId } from "./seeds";

// テンプレート生成エンジン（API なし）。
// 書き出し → よかった点 → 気になった点 → 締め の順に文を組み、語り口シードごとに語彙と文の長さを変える。
// どのパターンを使うかは乱数で決めるので、同じ回答でも毎回違う文になる。

export interface Ctx {
  p: CategoryPhrases;
  s: ScenePhrase;
  c: ContextPhrase;
  goods: GoodPhrase[];
  closers: GoodPhrase[];
  concerns: ConcernPhrase[];
  r: Rng;
}

// ---- 回答 → 言い回し ----------------------------------------------------

// 辞書に無い選択肢（プリセットを編集した場合など）はラベルから機械的に作る
const fallbackScene = (o: Option): ScenePhrase => ({
  v: `{c}${o.label}で利用しました`,
  n: o.label,
  why: `${o.label}で`,
  who: `${o.label}を考えている方`,
});
const fallbackContext = (o: Option): ContextPhrase => ({ pre: "", s: `${o.label}での利用でした`, who: "同じように考えている方" });
const fallbackGood = (o: Option): GoodPhrase => ({ a: `${o.label}と感じました`, te: `${o.label}と感じ`, n: `${o.label}ところ`, x: [], event: true });
const fallbackConcern = (o: Option): ConcernPhrase => ({ a: `${o.label}と感じました`, n: `${o.label}点` });
const EMPTY_CATEGORY: CategoryPhrases = { place: "こちら", noun: "お店", entering: "お店に入ると", scene: {}, context: {}, good: {}, concern: {} };

export function buildCtx(cat: Category, answers: Answers, r: Rng): Ctx {
  const p = PHRASES[cat.id] ?? EMPTY_CATEGORY;
  const res = resolveAnswers(cat, answers);
  const so = res.scene.options[0];
  const co = res.context.options[0];
  const s = so ? (p.scene[so.id] ?? fallbackScene(so)) : { v: "{c}利用しました", n: "利用", why: "今回", who: "気になっている方" };
  const c = co ? (p.context[co.id] ?? fallbackContext(co)) : { pre: "", s: "", who: "気になっている方" };
  const all = res.good.options.map((o) => p.good[o.id] ?? fallbackGood(o));
  return {
    p,
    s,
    c,
    goods: all.filter((x) => x.tag !== "closing"),
    closers: all.filter((x) => x.tag === "closing"),
    concerns: res.concern.options.map((o) => p.concern[o.id] ?? fallbackConcern(o)),
    r,
  };
}

// ---- 文の部品 -------------------------------------------------------------

/** 文（句点なし）。opt は長すぎるときに落としてよい文 */
interface Sent {
  t: string;
  opt?: boolean;
}
const S = (t: string, opt = false): Sent => ({ t, opt });

function visit(k: Ctx): Sent[] {
  const { s, c, r } = k;
  const variants: Sent[][] = [];
  if (s.v.includes("{c}")) {
    variants.push([S(s.v.replace("{c}", c.pre))]);
    if (c.s) variants.push([S(s.v.replace(/、?\{c\}/, "")), S(c.s, true)]);
  } else {
    variants.push(c.s ? [S(s.v), S(c.s, true)] : [S(s.v)]);
  }
  const out = pick(r, variants).map((x) => ({ ...x }));
  const prefix = pick(r, ["", "", "先日、", "今回、", "この前、"]);
  if (!out[0].t.includes(prefix.slice(0, 2))) out[0].t = prefix + out[0].t;
  return out;
}

// 「〜ました」→「〜た」。「〜ときのことです」と言うため
const PLAIN_PAST: [string, string][] = [
  ["いただきました", "いただいた"],
  ["行きました", "行った"],
  ["伺いました", "伺った"],
  ["寄りました", "寄った"],
  ["泊まりました", "泊まった"],
  ["もらいました", "もらった"],
  ["受けました", "受けた"],
  ["しました", "した"],
];
function toPlainPast(v: string): string | null {
  for (const [a, b] of PLAIN_PAST) if (v.endsWith(a)) return v.slice(0, -a.length) + b;
  return null;
}

/** 具体的な場面を先に書き、「◯◯したときのことです」と続ける書き出し */
function detailOpener(k: Ctx): { opener: Sent[]; used: GoodPhrase } | null {
  const g = k.goods.find((x) => x.x.length);
  const past = toPlainPast(k.s.v.replace("{c}", k.c.pre));
  if (!g || !past || !k.s.v.includes("{c}")) return null;
  return { opener: [S(pick(k.r, g.x)), S(`${past}ときのことです`)], used: g };
}

function reasonOpener(k: Ctx): Sent[] {
  const { p, s, c } = k;
  if (p.contextIsReason && c.pre) return [S(`${c.pre}、${p.place}を選びました`), S(s.v.replace(/、?\{c\}/, ""))];
  return [S(`${s.why}、${p.place}を選びました`), ...(c.s ? [S(c.s, true)] : [])];
}

type Style = "neutral" | "feeling" | "casual" | "short" | "warm" | "compare" | "timeline";

function goodSingle(style: Style, g: GoodPhrase, r: Rng, first: boolean): string[] {
  const forms: Record<Style, string[][]> = {
    neutral: [[g.a], [`特に${g.n}が印象に残りました`], [`${g.n}がよかったです`]],
    feeling: [[`${g.te}、うれしくなりました`], [`${g.n}が心に残っています`], [g.a, "それがいちばんうれしかったです"]],
    casual: [[`なにより${g.a}ね`], [`${g.te}、それがうれしかったです`], [`${g.n}、よかったです`]],
    short: [[g.a]],
    warm: [[`${g.te}、ありがたく感じました`], [`${g.n}がうれしかったです`], [g.a]],
    compare: [[`${g.n}は、想像していた以上でした`], [`想像していたよりも、${g.a}`]],
    timeline: first
      ? [[`最初に印象に残ったのは、${g.n}でした`], [`まず、${g.a}`]]
      : [[`それから、${g.a}`], [`ほかにも、${g.n}がよかったです`]],
  };
  let f = forms[style];
  // 出来事型の項目は「想像以上」「最初に印象に残った」に入れると不自然なので素直に言う
  if (g.event && (style === "compare" || style === "timeline")) f = first && style === "timeline" ? [[`まず、${g.a}`]] : forms.neutral.slice(0, 1);
  if (!g.n) f = [[g.a]];
  return pick(r, f);
}

function goodPair(style: Style, g1: GoodPhrase, g2: GoodPhrase, r: Rng): string[] {
  const forms: Partial<Record<Style, string[][]>> = {
    neutral: [[`${g1.te}、${g2.a}`], [g1.a, `${g2.n}もよかったです`], [`${g1.n}と${g2.n}が、特によかったです`]],
    feeling: [[`${g1.te}、${g2.a}`, "どちらもうれしかったです"], [`${g1.n}と${g2.n}に、満足しています`]],
    casual: [[`${g1.te}、しかも${g2.a}`], [`${g1.n}も${g2.n}も、よかったです`]],
    warm: [[`${g1.te}、${g2.a}`], [`${g1.n}と${g2.n}が、うれしかったです`]],
  };
  return pick(r, forms[style] ?? forms.neutral!);
}

function goodsBody(k: Ctx, style: Style, opts: { detailFirst?: boolean } = {}): string[] {
  const items = k.goods;
  const r = k.r;
  if (items.length === 0) return [];
  // 項目が少ないほど、ふくらませた一文を使って内容を厚くする
  const pElab = style === "short" ? 0.15 : items.length === 1 ? 0.7 : items.length === 2 ? 0.45 : 0.2;
  const out: string[] = [];
  let i = 0;
  if (opts.detailFirst && items[0].x.length) {
    out.push(pick(r, items[0].x));
    i = 1;
  }
  const canPair = style !== "short" && style !== "compare" && style !== "timeline";
  while (i < items.length) {
    const rest = items.length - i;
    // 出来事型の項目を連用形でつなぐと因果関係のように読めるので、つながない
    if (canPair && rest >= 2 && !items[i].event && (rest === 2 ? r() < 0.6 : r() < 0.5)) {
      out.push(...goodPair(style, items[i], items[i + 1], r));
      i += 2;
    } else {
      if (items[i].x.length && r() < pElab) {
        out.push(pick(r, items[i].x));
        i += 1;
        continue;
      }
      // 同じ型が続くと単調なので、前の文と同じ書き出しは避ける
      let s = goodSingle(style, items[i], r, i === 0);
      for (let t = 0; t < 3 && out.length && s[0].slice(0, 4) === out[out.length - 1].slice(0, 4); t++) {
        s = goodSingle(style, items[i], r, i === 0);
      }
      out.push(...s);
      i += 1;
    }
  }
  return out;
}

function concernBody(k: Ctx, style: Style): string[] {
  const cs = k.concerns;
  const r = k.r;
  if (cs.length === 0) return [];
  if (cs.length >= 2) {
    const [c1, c2] = cs;
    return pick(r, [
      [`ただ、${c1.a}`, `${c2.n}も少し気になりました`],
      [`気になったのは、${c1.n}と${c2.n}です`],
      [`一方で、${c1.n}と${c2.n}は少し気になりました`],
    ]);
  }
  const c = cs[0];
  const forms: Record<Style, string[][]> = {
    neutral: [[`ただ、${c.a}`], [`${c.n}は少し気になりました`], [`ひとつ挙げるなら、${c.n}が少し気になりました`]],
    feeling: [[`ただ、${c.n}だけは少し気になりました`], [`ただ、${c.a}`]],
    casual: [[`ひとつだけ言うと、${c.a}`], [`${c.n}は、ちょっと気になりました`]],
    short: [[`${c.n}は少し気になりました`], [`ただ、${c.a}`]],
    warm: [[`${c.n}は少し気になりましたが、ほかは気持ちよく過ごせました`], [`ただ、${c.a}`]],
    compare: [[`一方で、${c.a}`], [`ただ、${c.n}は少し気になりました`]],
    timeline: [[`ひとつ気になったのは、${c.n}です`], [`途中、${c.n}は少し気になりました`]],
  };
  return pick(r, forms[style]);
}

function closerLine(k: Ctx, casual = false): string[] {
  const cl = k.closers;
  if (cl.length === 0) return [];
  if (cl.length >= 2) return [`${cl[0].te}、${cl[1].a}`];
  const g = cl[0];
  return [casual && g.x.length ? g.x[0] : pick(k.r, [g.a, ...g.x])];
}

/**
 * 足りないときに差し込む文。事実を足さず、本文や締めと趣旨が重ならないものだけ。
 * before は気になった点の前、after は締めの前に入る。
 */
function pads(k: Ctx, used: string[]): { t: string; at: "before" | "after" }[] {
  const out: { t: string; at: "before" | "after" }[] = [];
  const said = used.join("");
  if (k.concerns.length) out.push({ t: "よかった点も気になった点も、正直に書いておきます", at: "before" });
  if (!said.includes("参考") && !said.includes(k.s.who)) out.push({ t: `${k.s.who}の参考になればうれしいです`, at: "after" });
  else if (!said.includes("感想")) out.push({ t: "今回の体験をもとに、感想を書いてみました", at: "after" });
  return out;
}

// ---- 語り口シード -----------------------------------------------------------

interface Plan {
  opener: Sent[];
  body: string[];
  concern: string[];
  closing: string[];
  /** 長さの目安（下限） */
  min?: number;
}

const SEED_BUILDERS: Record<SeedId, (k: Ctx) => Plan> = {
  plain: (k) => ({
    opener: visit(k),
    body: goodsBody(k, "short"),
    concern: concernBody(k, "neutral"),
    closing: closerLine(k).length ? closerLine(k) : [pick(k.r, ["参考になればうれしいです", "以上、今回の感想です"])],
  }),
  scene: (k) => {
    const idx = k.goods.findIndex((g) => g.tag === "impression");
    if (idx < 0) return SEED_BUILDERS.plain(k);
    const first = k.goods[idx];
    const rest = { ...k, goods: k.goods.filter((_, i) => i !== idx) };
    return {
      opener: [...visit(k), S(`${k.p.entering}、まず${first.n}が印象的でした`)],
      body: goodsBody(rest, "neutral"),
      concern: concernBody(k, "neutral"),
      closing: closerLine(k).length ? closerLine(k) : [`${k.s.who}の参考になればうれしいです`],
    };
  },
  feeling: (k) => {
    const lead = k.r() < 0.4;
    return {
      opener: lead ? [S("率直に感じたことを書いてみます"), ...visit(k)] : visit(k),
      body: goodsBody(k, "feeling"),
      concern: concernBody(k, "feeling"),
      closing: closerLine(k).length ? closerLine(k) : [lead ? "参考になればうれしいです" : "感じたことを、そのまま書いてみました"],
    };
  },
  recommend: (k) => ({
    opener: [S(`${k.s.who}に向けて、感想を書いてみます`), ...visit(k)],
    body: goodsBody(k, "neutral"),
    concern: concernBody(k, "neutral"),
    closing: [...closerLine(k), pick(k.r, [`${k.c.who}には、おすすめです`, `${k.c.who}には、一度試してみてほしいです`])],
  }),
  casual: (k) => ({
    opener: visit(k),
    body: goodsBody(k, "casual"),
    concern: concernBody(k, "casual"),
    closing: closerLine(k, true).length ? closerLine(k, true) : ["気になっている方の参考になればうれしいです"],
  }),
  detail: (k) => {
    const d = k.r() < 0.5 ? detailOpener(k) : null;
    if (d) {
      const rest = { ...k, goods: k.goods.filter((g) => g !== d.used) };
      return {
        opener: d.opener,
        body: goodsBody(rest, "neutral"),
        concern: concernBody(k, "neutral"),
        closing: closerLine(k).length ? closerLine(k) : ["参考になればうれしいです"],
      };
    }
    return {
      opener: visit(k),
      body: goodsBody(k, "neutral", { detailFirst: true }),
      concern: concernBody(k, "neutral"),
      closing: closerLine(k).length ? closerLine(k) : ["参考になればうれしいです"],
    };
  },
  reason: (k) => ({
    opener: reasonOpener(k),
    body: goodsBody(k, "neutral"),
    concern: concernBody(k, "neutral"),
    closing: closerLine(k).length ? closerLine(k) : [`${k.s.who}の参考になればと思います`],
  }),
  compare: (k) => ({
    opener: k.r() < 0.5 ? [S(`前から気になっていた${k.p.noun}です`), ...visit(k)] : visit(k),
    body: goodsBody(k, "compare"),
    concern: concernBody(k, "compare"),
    closing: closerLine(k).length ? closerLine(k) : ["迷っている方の参考になればうれしいです"],
  }),
  timeline: (k) => ({
    opener: k.r() < 0.4 ? [S("当日の流れにそって書いてみます"), ...visit(k)] : visit(k),
    body: goodsBody(k, "timeline"),
    concern: concernBody(k, "timeline"),
    closing: closerLine(k).length ? closerLine(k) : ["ひと通りの流れは、こんな感じでした"],
  }),
  who: (k) => ({
    opener: k.r() < 0.5 ? [S(`${k.c.who}に向いている${k.p.noun}だと思います`), ...visit(k)] : visit(k),
    body: goodsBody(k, "neutral"),
    concern: concernBody(k, "neutral"),
    closing: [...closerLine(k), pick(k.r, [`${k.c.who}には、特に合うと思います`, `${k.s.who}にも向いていると思います`, "参考になればうれしいです"])],
  }),
  short: (k) => ({
    opener: visit(k).slice(0, 1),
    body: goodsBody(k, "short"),
    concern: concernBody(k, "short"),
    closing: closerLine(k).length ? closerLine(k) : ["以上です"],
    min: 90,
  }),
  warm: (k) => ({
    opener: visit(k),
    body: goodsBody(k, "warm"),
    concern: concernBody(k, "warm"),
    closing: [...closerLine(k), "今回はありがとうございました"],
  }),
};

// ---- 組み立て ---------------------------------------------------------------

export const TARGET_MIN = 120;
export const TARGET_MAX = 180;

const join = (ss: Sent[]) => ss.map((s) => s.t + "。").join("");

const CANDIDATES = 10;
const MAX_SENTENCES = 5;

// 1案の中で2回出ると単調に見える言い回し
const REPEAT_WATCH = ["特に", "うれし", "よかったです", "想像していた", "気持ちよく過ごせ", "助かりました", "印象"];

/** 目安（120〜180字・5文以内・言い回しの重複なし）からのずれ。小さいほどよい */
export function score(text: string, min = TARGET_MIN): number {
  const len = [...text].length;
  const sentences = text.split("。").filter(Boolean).length;
  const repeats = REPEAT_WATCH.reduce((n, w) => n + Math.max(0, text.split(w).length - 2), 0);
  return Math.max(0, min - len) + Math.max(0, len - TARGET_MAX) + 12 * Math.max(0, sentences - MAX_SENTENCES) + 15 * repeats;
}

/** 1案を作る。乱数で何通りか組み、目安にいちばん近いものを返す */
export function renderSeed(seed: SeedId, k: Ctx): string {
  let best = "";
  let bestScore = Infinity;
  for (let i = 0; i < CANDIDATES && bestScore > 0; i++) {
    const text = renderOnce(seed, k);
    // 長さを詰めすぎると言い回しが毎回同じになるので、下限は目安より少し緩める
    const sc = score(text, seed === "short" ? 90 : TARGET_MIN - 15);
    if (sc < bestScore) [best, bestScore] = [text, sc];
  }
  return best;
}

/** 長さは足りなければ1文だけ差し込み、長すぎれば省ける文を落とす */
function renderOnce(seed: SeedId, k: Ctx): string {
  const plan = SEED_BUILDERS[seed](k);
  const min = plan.min ?? TARGET_MIN - 10;
  const body = plan.body.map((t) => S(t));
  const concern = plan.concern.map((t) => S(t));
  const closing = plan.closing.map((t) => S(t));
  const base = [...plan.opener, ...body, ...concern, ...closing];
  const before: Sent[] = [];
  const after: Sent[] = [];
  if (join(base).length < min) {
    const cand = pads(k, base.map((s) => s.t));
    if (cand.length) {
      const pad = pick(k.r, cand);
      (pad.at === "before" ? before : after).push(S(pad.t, true));
    }
  }
  let all = [...plan.opener, ...body, ...before, ...concern, ...after, ...closing];
  // 長すぎるときは省ける文を後ろから落とす
  while (join(all).length > TARGET_MAX + 15) {
    const i = all.map((s) => !!s.opt).lastIndexOf(true);
    if (i < 0) break;
    all = all.filter((_, j) => j !== i);
  }
  return dedupe(join(all));
}

/** 同じ文が2度出たら後ろを消す */
function dedupe(text: string): string {
  const seen = new Set<string>();
  return text
    .split("。")
    .filter((s) => s)
    .filter((s) => (seen.has(s) ? false : (seen.add(s), true)))
    .map((s) => s + "。")
    .join("");
}
