import { describe, expect, it } from "vitest";
import { generateTemplateDrafts } from "./generate";
import { NONE_ID, QUESTION_ORDER } from "./presets";
import { seededRng } from "./rng";
import {
  checkStore,
  decodeStore,
  draftFromPreset,
  encodeStore,
  fromPayload,
  isQuestionEdited,
  storeUrl,
  toCategory,
  toPayload,
  tokenFromHash,
} from "./store-config";
import { buildCtx } from "./template";

const PID = "ChIJN1t_tDeuEmsRUsoyG83frY4";

function edited() {
  const d = draftFromPreset("restaurant", "らーめん太郎");
  d.placeId = PID;
  d.questions.scene.label = "何を食べましたか？";
  d.questions.scene.options = [{ label: "ラーメン" }, { label: "つけ麺" }, { presetId: "takeout", label: "テイクアウト" }];
  d.questions.good.options = [
    { presetId: "taste", label: "スープがおいしい" },
    { presetId: "service", label: "接客がていねい" },
    { label: "麺がもちもち" },
    { label: "スタッフが親切" },
  ];
  d.questions.concern.options = [{ label: "駐車場が狭かった" }, { presetId: "wait", label: "待ち時間が長かった" }, { label: "カウンターの高さ" }];
  return d;
}

describe("店舗設定", () => {
  it("プリセットそのままなら差分は空で URL が短い", async () => {
    const d = draftFromPreset("hotel", "湯宿");
    expect(toPayload(d)).toEqual({ v: 1, c: "hotel", n: "湯宿" });
    expect((await encodeStore(d)).length).toBeLessThan(60);
  });

  it("URL に入れて戻すと同じ設定になる", async () => {
    const d = edited();
    const token = await encodeStore(d);
    expect(token).toMatch(/^[zj][A-Za-z0-9_-]+$/);
    expect(await decodeStore(token)).toEqual(d);
    const url = storeUrl("https://x.github.io/repo/", token);
    expect(tokenFromHash(new URL(url).hash)).toBe(token);
  });

  it("編集したかどうか", () => {
    const d = edited();
    expect(isQuestionEdited(d, "scene")).toBe(true);
    expect(isQuestionEdited(d, "context")).toBe(false);
  });

  it("toCategory: 名前を変えた・足した選択肢はラベルから文章を作る。「特にない」は先頭に付く", () => {
    const cat = toCategory(edited());
    const [q1, , q3, q4] = cat.questions;
    expect(q1.label).toBe("何を食べましたか？");
    expect(q1.options).toEqual([
      { id: "x1", label: "ラーメン", useLabel: true },
      { id: "x2", label: "つけ麺", useLabel: true },
      { id: "takeout", label: "テイクアウト" },
    ]);
    expect(q3.options[0]).toEqual({ id: "taste", label: "スープがおいしい", useLabel: true });
    expect(q3.options[1]).toEqual({ id: "service", label: "接客がていねい" });
    expect(q4.options[0].id).toBe(NONE_ID);
    expect(q4.maxSelect).toBe(2);
  });

  it("足した選択肢でも下書きが検証を通り、気になった点が入る", () => {
    const cat = toCategory(edited());
    const r = seededRng(3);
    const a = { scene: ["x1"], context: ["family"], good: ["taste", "x1", "x2"], concern: ["x1", "x2"] };
    const k = buildCtx(cat, a, r);
    expect(k.goods.map((g) => g.n)).toEqual(["スープがおいしいところ", "麺がもちもちなところ", "スタッフが親切なところ"]);
    for (let i = 0; i < 20; i++) {
      const drafts = generateTemplateDrafts(cat, a, { rng: r });
      expect(drafts).toHaveLength(3);
      for (const d of drafts) {
        expect(d.text).toContain("ラーメン");
        expect(d.text.includes("駐車場が狭かった")).toBe(true);
        expect(d.text).not.toContain("料理のおいしさ");
      }
    }
  });
});

describe("検査", () => {
  it("プリセットそのままなら問題なし（店名だけ必要）", () => {
    expect(checkStore(draftFromPreset("clinic", "さくら整体院"))).toEqual([]);
    expect(checkStore(draftFromPreset("clinic")).map((i) => i.path)).toEqual(["name"]);
  });

  it("満足度・星を聞く質問は作れない", () => {
    const d = draftFromPreset("restaurant", "店");
    d.questions.scene.label = "今日の満足度は？";
    expect(checkStore(d)).toContainEqual(expect.objectContaining({ path: "scene.label", level: "error" }));
  });

  it("禁止語・金額・空欄・重複・数の上下限", () => {
    const d = draftFromPreset("restaurant", "店");
    d.questions.good.options = [{ label: "最高の味" }, { label: "1000円で満腹" }, { label: "" }, { label: "安い" }, { label: "安い" }];
    const paths = checkStore(d).map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(["good.options.0", "good.options.1", "good.options.2", "good.options.4"]));
    d.questions.context.options = [{ label: "ひとり" }];
    expect(checkStore(d).map((i) => i.path)).toContain("context.options");
  });

  it("Place ID の形式違いは警告だけ", () => {
    const d = draftFromPreset("restaurant", "店");
    d.placeId = "abc";
    expect(checkStore(d)).toEqual([expect.objectContaining({ path: "placeId", level: "warn" })]);
  });
});

describe("URL から来た値の無害化", () => {
  it("壊れた・知らない値は読まない", async () => {
    expect(await decodeStore("")).toBeNull();
    expect(await decodeStore("zzzz")).toBeNull();
    expect(await decodeStore("x" + "a".repeat(10))).toBeNull();
    expect(fromPayload({ v: 2, c: "restaurant", n: "a" })).toBeNull();
    expect(fromPayload({ v: 1, c: "nope", n: "a" })).toBeNull();
  });

  it("不正な Place ID・長すぎる文字・制御文字・禁止語の選択肢を落とす", () => {
    const d = fromPayload({
      v: 1,
      c: "restaurant",
      n: "店\u0000".padEnd(100, "あ"),
      p: "javascript:alert(1)",
      q: {
        scene: { l: "満足度は？", o: [["", "とても満足"], ["", "最高"], ["", "ふつう"], "lunch", "lunch", "bogus", 42] },
      },
    })!;
    expect(d.name).not.toContain("\u0000");
    expect([...d.name].length).toBe(40);
    expect(d.placeId).toBe("");
    expect(d.questions.scene.label).toBe("何を召し上がりましたか？");
    expect(d.questions.scene.options).toEqual([{ label: "とても満足" }, { label: "ふつう" }, { presetId: "lunch", label: "ランチ" }]);
  });

  it("選択肢が少なすぎたらプリセットに戻す", () => {
    const d = fromPayload({ v: 1, c: "restaurant", n: "店", q: { good: { o: ["taste"] } } })!;
    expect(d.questions.good).toEqual(draftFromPreset("restaurant").questions.good);
  });

  it("すべての業種で往復できる", async () => {
    for (const c of ["restaurant", "izakaya", "hair_salon", "beauty", "clinic", "fitness", "hotel", "realestate"]) {
      const d = draftFromPreset(c, "店");
      for (const q of QUESTION_ORDER) d.questions[q].options.reverse();
      expect(await decodeStore(await encodeStore(d))).toEqual(d);
    }
  });
});
