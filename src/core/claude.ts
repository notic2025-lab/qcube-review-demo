import type Anthropic from "@anthropic-ai/sdk";
import type { Draft } from "./generate";
import type { Answers, Category } from "./presets";
import { resolveAnswers } from "./presets";
import type { Rng } from "./rng";
import { shuffle } from "./rng";
import type { SeedId } from "./seeds";
import { SEEDS, SEED_IDS } from "./seeds";
import { validateDraft } from "./validate";

// Claude モード（BYOK）。デモの説明者が自分の API キーを管理者ページに入れたときだけ使う。
//
// ブラウザから直接 API を呼ぶ（dangerouslyAllowBrowser）。これが許容されるのは、
// キーが説明者本人のもので、本人の端末の localStorage にしか置かれないから。
// 不特定多数に配るページにキーを埋め込む用途ではない。キーは URL・ログ・ビルド成果物に出さない。

export const CLAUDE_MODEL = "claude-haiku-4-5";

const TOOL_NAME = "submit_review_drafts";

const TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: "口コミの下書きを3案提出する。案はそれぞれ異なる語り口で書く。",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      drafts: {
        type: "array",
        description: "口コミの下書き3案。各案は120〜180字、です・ます調、3〜4文",
        items: { type: "string" },
      },
    },
    required: ["drafts"],
    additionalProperties: false,
  },
};

export interface PromptParts {
  system: string;
  user: string;
  seeds: SeedId[];
}

/**
 * プロンプトを組む。お客さまの自由記述は受け取らない。回答は選択肢 ID で受け、ラベルに解決してから渡す。
 * （ラベルは業種プリセットか、管理者ページでお店が決めた選択肢）
 */
export function buildPrompt(cat: Category, answers: Answers, storeName: string, r: Rng): PromptParts {
  const res = resolveAnswers(cat, answers);
  const seeds = shuffle(r, SEED_IDS).slice(0, 3);
  const concerns = res.concern.options.map((o) => o.label);
  const hints = cat.aiHints ?? {};

  const system = [
    "あなたは、来店したお客さま本人が口コミを書くのを手伝います。",
    "お客さまが選んだ内容だけをもとに、その人が書いたように自然な文章を作ってください。",
    "",
    "【必ず守ること】",
    "- 120〜180字、3〜4文",
    "- です・ます調",
    "- お客さまが選んでいない事実を足さない",
    "- 店員の名前、金額、他店との比較を書かない",
    "- 誇張した断定を使わない（最高、絶対、No.1、日本一、必ず、間違いなし など）",
    "- 広告の文章にしない。ふつうの人が書く言葉づかいにする",
    "- 絵文字は使わない",
    "- 「私は」と書かない",
    ...(concerns.length
      ? [
          "",
          "【気になった点の扱い】",
          "- 選ばれた気になった点は、必ず文章に含める。省かない",
          "- 選ばれた表現の範囲で、おだやかに書く。強い非難にしない",
          "- よかった点と気になった点の両方に触れ、どちらかに偏らせない",
        ]
      : []),
    ...(hints.note ? ["", `- ${hints.note}`] : []),
    ...(hints.avoid?.length ? [`- 次の表現は使わない: ${hints.avoid.join("、")}`] : []),
    "",
    "【今回の語り口】",
    ...seeds.map((s, i) => `- 案${i + 1}: ${SEEDS[s]}`),
    "",
    "【出力】",
    `- 異なる語り口で3案。必ず ${TOOL_NAME} ツールで提出する`,
  ].join("\n");

  const line = (q: { question: { label: string }; options: { label: string }[] }) =>
    `- ${q.question.label} → ${q.options.map((o) => o.label).join("、") || "（未回答）"}`;
  const user = [
    `業種: ${cat.label}`,
    `店名: ${storeName}`,
    "",
    "お客さまの回答:",
    line(res.scene),
    line(res.context),
    line(res.good),
    "",
    `気になったところ: ${concerns.length ? concerns.join("、") : "特になし（短所には触れないでください）"}`,
  ].join("\n");

  return { system, user, seeds };
}

/** ツールの入力を読む。ツールが返らなければ本文の JSON も拾う */
export function extractDrafts(content: Anthropic.ContentBlock[]): string[] {
  for (const b of content) {
    if (b.type === "tool_use" && b.name === TOOL_NAME) {
      const drafts = (b.input as { drafts?: unknown }).drafts;
      if (Array.isArray(drafts)) return drafts.filter((d): d is string => typeof d === "string");
    }
  }
  const text = content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  const m = /\{[\s\S]*"drafts"[\s\S]*\}/.exec(text);
  if (m) {
    try {
      const drafts = (JSON.parse(m[0]) as { drafts?: unknown }).drafts;
      if (Array.isArray(drafts)) return drafts.filter((d): d is string => typeof d === "string");
    } catch {
      // 読めなければ空
    }
  }
  return [];
}

export class ClaudeError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "rate" | "network" | "api" | "empty",
  ) {
    super(message);
  }
}

const MAX_CALLS = 2;

/**
 * Claude で3案を作る。検証（字数・禁止語・金額・書き出しの重複）に落ちた案は作り直す。
 * 3案そろわなければ、そろった分だけ返す（足りない分は呼び出し側がテンプレートで補う）。
 */
export async function generateClaudeDrafts(
  cat: Category,
  answers: Answers,
  opts: { apiKey: string; storeName: string; history: string[]; rng?: Rng },
): Promise<Draft[]> {
  const { default: AnthropicSDK } = await import("@anthropic-ai/sdk");
  const client = new AnthropicSDK({
    apiKey: opts.apiKey,
    // 上のコメントのとおり、説明者本人のキーを本人の端末からだけ使う前提
    dangerouslyAllowBrowser: true,
    timeout: 30_000,
    maxRetries: 1,
  });
  const r = opts.rng ?? Math.random;
  const avoid = cat.aiHints?.avoid ?? [];
  const accepted: Draft[] = [];

  for (let call = 0; call < MAX_CALLS && accepted.length < 3; call++) {
    const p = buildPrompt(cat, answers, opts.storeName, r);
    let res: Anthropic.Message;
    try {
      res = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4000,
        temperature: 1,
        system: p.system,
        tools: [TOOL],
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: p.user }],
      });
    } catch (e) {
      if (e instanceof AnthropicSDK.AuthenticationError || e instanceof AnthropicSDK.PermissionDeniedError) {
        throw new ClaudeError("APIキーが正しくないか、使えない状態です", "auth");
      }
      if (e instanceof AnthropicSDK.RateLimitError) throw new ClaudeError("利用上限に達しました。少し待ってから試してください", "rate");
      if (e instanceof AnthropicSDK.APIConnectionError) throw new ClaudeError("Claude に接続できませんでした", "network");
      if (e instanceof AnthropicSDK.APIError) throw new ClaudeError(`Claude でエラーが起きました（${e.status ?? "?"}）`, "api");
      throw e;
    }
    extractDrafts(res.content).forEach((raw, i) => {
      const text = raw.replace(/\s+/g, " ").trim();
      if (accepted.length >= 3) return;
      const err = validateDraft(text, { avoid, history: [...opts.history, ...accepted.map((d) => d.text)] });
      if (!err) accepted.push({ seed: p.seeds[i] ?? p.seeds[0], text });
    });
  }
  if (!accepted.length) throw new ClaudeError("条件に合う文章が返ってきませんでした", "empty");
  return accepted;
}
