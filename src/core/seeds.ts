// 語り口シード。3案はここから重複なく3つ選ぶ。
// テンプレートモードでは語彙・文の長さの切り替えに、Claude モードではプロンプトの指示文に使う。
export const SEEDS = {
  plain: "淡々と短い文で",
  scene: "入店時の様子から",
  feeling: "感じたことを中心に",
  recommend: "人にすすめる調子",
  casual: "くだけた話し言葉",
  detail: "具体的な場面をひとつ",
  reason: "利用した理由から",
  compare: "想像との違い",
  timeline: "入店から帰るまで",
  who: "どんな人向きか",
  short: "要点だけ短く",
  warm: "やわらかく落ち着いて",
} as const;

export type SeedId = keyof typeof SEEDS;
export const SEED_IDS = Object.keys(SEEDS) as SeedId[];
