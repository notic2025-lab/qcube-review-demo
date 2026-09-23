import { describe, expect, it } from "vitest";
import { generateTemplateDrafts } from "./generate";
import { PHRASES } from "./phrases";
import { CATEGORIES, NONE_ID } from "./presets";
import type { Answers, Category } from "./presets";
import { pick, seededRng, shuffle } from "./rng";
import type { Rng } from "./rng";
import { SEED_IDS } from "./seeds";
import { buildCtx, renderSeed } from "./template";
import { BANNED_WORDS, MAX_LEN, MIN_LEN, prefixOf, validateDraft } from "./validate";

function randomAnswers(cat: Category, r: Rng): Answers {
  const [scene, context, good, concern] = cat.questions;
  const nc = Math.floor(r() * 3);
  return {
    scene: [pick(r, scene.options).id],
    context: [pick(r, context.options).id],
    good: shuffle(r, good.options).slice(0, 1 + Math.floor(r() * 3)).map((o) => o.id),
    concern: nc === 0 ? [NONE_ID] : shuffle(r, concern.options.filter((o) => !o.exclusive)).slice(0, nc).map((o) => o.id),
  };
}

describe("言い回し辞書", () => {
  it("すべての業種・選択肢に言い回しがある（ラベルからの機械的な穴埋めに落ちない）", () => {
    const missing: string[] = [];
    for (const cat of CATEGORIES) {
      const p = PHRASES[cat.id];
      if (!p) {
        missing.push(cat.id);
        continue;
      }
      const [q1, q2, q3, q4] = cat.questions;
      for (const o of q1.options) if (!p.scene[o.id]) missing.push(`${cat.id}.scene.${o.id}`);
      for (const o of q2.options) if (!p.context[o.id]) missing.push(`${cat.id}.context.${o.id}`);
      for (const o of q3.options) if (!p.good[o.id]) missing.push(`${cat.id}.good.${o.id}`);
      for (const o of q4.options) if (!o.exclusive && !p.concern[o.id]) missing.push(`${cat.id}.concern.${o.id}`);
    }
    expect(missing).toEqual([]);
  });

  it("辞書の中に禁止語・金額・一人称が無い", () => {
    const text = JSON.stringify(PHRASES);
    for (const w of BANNED_WORDS) expect(text).not.toContain(w);
    expect(text).not.toMatch(/[¥￥円]/);
    expect(text).not.toContain("私");
  });
});

describe("テンプレート生成", () => {
  const r = seededRng(20260924);
  const cases = CATEGORIES.flatMap((cat) => Array.from({ length: 40 }, () => ({ cat, a: randomAnswers(cat, r) })));

  it("全業種 × ランダム回答で 3 案、語り口はすべて異なる", () => {
    for (const { cat, a } of cases) {
      const drafts = generateTemplateDrafts(cat, a, { rng: r });
      expect(drafts).toHaveLength(3);
      expect(new Set(drafts.map((d) => d.seed)).size).toBe(3);
      expect(new Set(drafts.map((d) => prefixOf(d.text))).size).toBe(3);
    }
  });

  it("検証を通る（80〜250字・禁止語なし・金額なし・業種の避ける表現なし）", () => {
    for (const { cat, a } of cases) {
      for (const d of generateTemplateDrafts(cat, a, { rng: r })) {
        const len = [...d.text].length;
        expect(len, d.text).toBeGreaterThanOrEqual(MIN_LEN);
        expect(len, d.text).toBeLessThanOrEqual(MAX_LEN);
        expect(validateDraft(d.text, { avoid: cat.aiHints?.avoid }), d.text).toBeNull();
      }
    }
  });

  it("気になった点が選ばれていれば、すべての案に必ず入る", () => {
    for (const { cat, a } of cases) {
      const k = buildCtx(cat, a, r);
      for (const d of generateTemplateDrafts(cat, a, { rng: r })) {
        for (const c of k.concerns) expect(d.text.includes(c.a) || d.text.includes(c.n), `${c.n} / ${d.text}`).toBe(true);
      }
    }
  });

  it("「特にない」なら気になった点に触れない", () => {
    for (const { cat, a } of cases.filter((x) => x.a.concern?.[0] === NONE_ID)) {
      for (const d of generateTemplateDrafts(cat, a, { rng: r })) {
        expect(d.text).not.toMatch(/気にな(った|りました)|一方で|ただ、/);
      }
    }
  });

  it("よかった点はすべての案に反映される", () => {
    for (const { cat, a } of cases) {
      const k = buildCtx(cat, a, r);
      for (const d of generateTemplateDrafts(cat, a, { rng: r })) {
        for (const g of [...k.goods, ...k.closers]) {
          const hit = [g.a, g.te, g.n, ...g.x].filter(Boolean).some((t) => d.text.includes(t));
          expect(hit, `${g.a} / ${d.text}`).toBe(true);
        }
      }
    }
  });

  it("同じ回答で何度作っても毎回違う文が出る", () => {
    const cat = CATEGORIES[0];
    const a: Answers = { scene: ["lunch"], context: ["family"], good: ["taste", "service"], concern: [NONE_ID] };
    const texts = new Set<string>();
    for (let i = 0; i < 10; i++) for (const d of generateTemplateDrafts(cat, a, { rng: r })) texts.add(d.text);
    expect(texts.size).toBeGreaterThan(20);
  });

  it("直近の生成文と先頭30字が一致する案は出さない", () => {
    const cat = CATEGORIES[0];
    const a: Answers = { scene: ["lunch"], context: ["family"], good: ["taste"], concern: [NONE_ID] };
    const history: string[] = [];
    for (let i = 0; i < 6; i++) {
      const drafts = generateTemplateDrafts(cat, a, { rng: r, history });
      for (const d of drafts) expect(history.map(prefixOf)).not.toContain(prefixOf(d.text));
      history.unshift(...drafts.map((d) => d.text));
      history.splice(20);
    }
  });

  it("すべての語り口シードが単独でも文を作れる", () => {
    for (const cat of CATEGORIES) {
      for (const seed of SEED_IDS) {
        const text = renderSeed(seed, buildCtx(cat, randomAnswers(cat, r), r));
        expect(text.endsWith("。")).toBe(true);
        expect(text).not.toContain("{c}");
        expect(text).not.toContain("undefined");
        expect(text).not.toMatch(/。。|、。|、、/);
      }
    }
  });
});

describe("validateDraft", () => {
  const ok = "家族でランチに伺いました。料理がおいしく、接客もていねいでした。子ども連れでも過ごしやすく、ゆっくり食事ができました。ただ、待ち時間が少し長かったです。参考になればうれしいです。";
  it("通常の文は通る", () => expect(validateDraft(ok)).toBeNull());
  it("短すぎ・長すぎ", () => {
    expect(validateDraft("おいしかったです。")).toMatch(/too_short/);
    expect(validateDraft(ok.repeat(3))).toMatch(/too_long/);
  });
  it("禁止語・金額・絵文字・一人称", () => {
    expect(validateDraft(ok + "最高でした。")).toMatch(/banned/);
    expect(validateDraft(ok + "No.1のお店です。")).toMatch(/banned/);
    expect(validateDraft(ok + "1000円でした。")).toBe("money");
    expect(validateDraft(ok + "¥1000でした。")).toBe("money");
    expect(validateDraft(ok + "😊")).toBe("emoji");
    expect(validateDraft("私は" + ok)).toBe("first_person");
  });
  it("業種の避ける表現", () => {
    expect(validateDraft(ok + "腰痛が治ると思います。", { avoid: ["治る"] })).toBe("banned:治る");
  });
  it("直近と先頭30字が一致したら落とす", () => {
    expect(validateDraft(ok, { history: [ok.slice(0, 30) + "別の文です。"] })).toBe("duplicate_prefix");
  });
});
