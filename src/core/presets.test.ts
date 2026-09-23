import { describe, expect, it } from "vitest";
import raw from "../../survey-presets.json";
import { CATEGORIES, NONE_ID, normalizePresets, resolveAnswers } from "./presets";
import type { RawPresets } from "./presets";

describe("normalizePresets", () => {
  it("8業種・各4問を scene/context/good/concern の順で持つ", () => {
    expect(CATEGORIES).toHaveLength(8);
    for (const c of CATEGORIES) expect(c.questions.map((q) => q.id)).toEqual(["scene", "context", "good", "concern"]);
  });

  it("「特にない」は Q4 の先頭にだけ付く（排他）", () => {
    for (const c of CATEGORIES) {
      const [q1, q2, q3, q4] = c.questions;
      expect(q4.options[0]).toEqual({ id: NONE_ID, label: "特にない", exclusive: true });
      expect(q4.options.filter((o) => o.id === NONE_ID)).toHaveLength(1);
      for (const q of [q1, q2, q3]) expect(q.options.some((o) => o.id === NONE_ID)).toBe(false);
    }
  });

  it("形式と最大選択数", () => {
    for (const c of CATEGORIES) {
      const [q1, q2, q3, q4] = c.questions;
      expect([q1.type, q2.type, q3.type, q4.type]).toEqual(["single", "single", "multi", "multi"]);
      expect([q1.maxSelect, q2.maxSelect, q3.maxSelect, q4.maxSelect]).toEqual([1, 1, 3, 2]);
    }
  });

  it("プリセット側に none が入っていても二重に付けない", () => {
    const p = structuredClone(raw) as RawPresets;
    p.categories[0].questions[3].options.push({ id: "none", label: "特にない" });
    const q4 = normalizePresets(p)[0].questions[3];
    expect(q4.options.filter((o) => o.id === "none")).toHaveLength(1);
  });
});

describe("resolveAnswers", () => {
  const cat = CATEGORIES.find((c) => c.id === "restaurant")!;

  it("ID をラベルに解決する", () => {
    const r = resolveAnswers(cat, { scene: ["lunch"], context: ["family"], good: ["taste", "service"], concern: ["wait"] });
    expect(r.scene.options.map((o) => o.label)).toEqual(["ランチ"]);
    expect(r.good.options.map((o) => o.label)).toEqual(["料理がおいしい", "接客がていねい"]);
    expect(r.concern.options.map((o) => o.label)).toEqual(["待ち時間が長かった"]);
  });

  it("存在しない ID は無視する", () => {
    const r = resolveAnswers(cat, { scene: ["nope"], good: ["taste", "<script>", "wait"] });
    expect(r.scene.options).toEqual([]);
    expect(r.good.options.map((o) => o.id)).toEqual(["taste"]);
  });

  it("maxSelect を超えた分は切る・重複は1つにする", () => {
    const r = resolveAnswers(cat, { good: ["taste", "taste", "fresh", "menu", "volume"], concern: ["wait", "noisy", "price"] });
    expect(r.good.options.map((o) => o.id)).toEqual(["taste", "fresh", "menu"]);
    expect(r.concern.options.map((o) => o.id)).toEqual(["wait", "noisy"]);
  });

  it("「特にない」が入っていれば気になった点は空", () => {
    const r = resolveAnswers(cat, { concern: ["wait", "none"] });
    expect(r.concern.options).toEqual([]);
  });
});
