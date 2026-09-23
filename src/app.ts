import { destinationFor } from "./core/destination";
import { generateDrafts } from "./core/engine";
import type { Draft } from "./core/generate";
import { detectInAppBrowser, detectOS, lineExternalUrl } from "./core/platform";
import type { Answers, Category, Question } from "./core/presets";
import { NONE_ID, findCategory } from "./core/presets";
import { loadHistory, pushHistory } from "./core/storage";
import { decodeStore, draftFromPreset, encodeStore, loadSavedStore, toCategory, tokenFromHash } from "./core/store-config";
import { DEMO_STORES } from "./stores";

// お客さま用ページ。お店の設定（店名・業種・投稿先・アンケート）は管理者ページが発行したURL（#s=...）から読む。
// 画面は1枚。状態を持って描き直すだけのシンプルな状態遷移にしている。
//
// 設計上の前提（崩さないこと）:
// - 自動投稿はしない・できない。「生成 → 本人がコピー → 投稿フォームへ遷移 → 本人が貼って投稿」だけ
// - 満足度で導線を分岐させない（レビューゲーティング禁止）。何を選んでも同じ下書き画面・同じ投稿導線
// - 投稿できたかは検知できない。完了画面は「ご協力ありがとうございました」

type Screen = "landing" | "invalid" | "intro" | "question" | "generating" | "draft" | "handoff" | "thanks";

/** 開いているお店。管理者ページの URL から来るか、業種デモ（#/restaurant など）か */
interface Store {
  name: string;
  cat: Category;
  placeId: string;
}

interface State {
  screen: Screen;
  store?: Store;
  cat?: Category;
  step: number;
  answers: Answers;
  drafts: Draft[];
  /** 表示・編集用の本文。drafts と同じ並び */
  texts: string[];
  idx: number;
  editing: boolean;
  copy: "pending" | "ok" | "fail" | null;
  opened: boolean;
  wentHidden: boolean;
  busy: boolean;
}

const st: State = {
  screen: "landing",
  step: 0,
  answers: {},
  drafts: [],
  texts: [],
  idx: 0,
  editing: false,
  copy: null,
  opened: false,
  wentHidden: false,
  busy: false,
};
const os = detectOS();
const inApp = detectInAppBrowser();

let root: HTMLElement;

// ---- helpers ----------------------------------------------------------------

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const storeName = () => st.store?.name ?? "";
const dest = () => destinationFor(st.store?.placeId ?? "");
const currentText = () => st.texts[st.idx] ?? "";
const len = (s: string) => [...s.trim()].length;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * クリップボードへコピー。
 * iOS Safari はユーザー操作の同期処理内でしかクリップボードを許さないので、
 * クリックハンドラから直接（await を挟まずに）呼ぶこと。
 */
function copyText(text: string, done: (ok: boolean) => void): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => done(true),
      () => done(legacyCopy(text)),
    );
  } else {
    done(legacyCopy(text));
  }
}

function legacyCopy(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

// ---- 画面 -------------------------------------------------------------------

function header(opts: { back?: boolean } = {}) {
  return `<header class="bar">
    ${opts.back ? `<button class="text-btn back" data-act="back">‹ もどる</button>` : `<span></span>`}
    <span class="bar-store">${esc(storeName())}</span>
    <span></span>
  </header>`;
}

function inAppBanner() {
  if (!inApp) return "";
  const line = inApp === "line" ? `<a class="btn small" href="${esc(lineExternalUrl())}">ブラウザで開き直す</a>` : "";
  return `<div class="banner warn" role="note">
    <strong>ブラウザで開き直してください</strong>
    <p>アプリ内のブラウザでは、コピーや投稿画面の切り替えがうまく動かないことがあります。右上のメニューから「ブラウザで開く」を選んでください。</p>
    ${line}
  </div>`;
}

const adminHref = () => `${import.meta.env.BASE_URL}admin/`;

/** デモのトップ。お客さま用ページと管理者ページの入口 */
function viewLanding() {
  return `<main class="page landing top">
    <p class="eyebrow">デモ</p>
    <h1 tabindex="-1">口コミ下書き生成</h1>
    <p class="muted">見たいページを選んでください。</p>
    <div class="entry">
      <button class="entry-card" data-act="openCustomer">
        <span class="entry-title">お客さま用ページ</span>
        <span class="entry-desc">来店客がQRコードから開く画面。4つの質問に答えると口コミの下書きができます</span>
      </button>
      <a class="entry-card" href="${adminHref()}">
        <span class="entry-title">管理者ページ</span>
        <span class="entry-desc">お店の設定とアンケートを編集し、お客さま用のURLとQRコードを発行します</span>
      </a>
    </div>
    <p class="fineprint">お客さま用ページは、管理者ページで最後に編集した内容で開きます（まだ編集していなければ飲食店のひな形）。</p>
  </main>`;
}

function viewInvalid() {
  return `<main class="page landing">
    <h1 tabindex="-1">お店の情報を読み込めませんでした</h1>
    <p class="muted">QRコードをもう一度読み取ってください。解決しない場合は、お店の方にお知らせください。</p>
  </main>`;
}

function viewIntro() {
  return `${header()}
  <main class="page intro">
    ${inAppBanner()}
    <p class="store-name">${esc(storeName())}</p>
    <h1 tabindex="-1">4つの質問に答えるだけ。<br>口コミの文章は、AIがかわりに書きます</h1>
    <p class="muted">約30秒で終わります</p>
    <button class="btn primary big" data-act="start">はじめる</button>
  </main>`;
}

function dots() {
  return `<div class="dots" aria-label="質問 ${st.step + 1} / 4">${[0, 1, 2, 3]
    .map((i) => `<span class="${i < st.step ? "done" : i === st.step ? "now" : ""}"></span>`)
    .join("")}</div>`;
}

function viewQuestion() {
  const q = st.cat!.questions[st.step];
  const sel = st.answers[q.id] ?? [];
  const multi = q.type === "multi";
  const realMax = q.maxSelect;
  const chosen = sel.filter((id) => id !== NONE_ID);
  const full = multi && chosen.length >= realMax;
  const opts = q.options
    .map((o) => {
      const on = sel.includes(o.id);
      const disabled = multi && !on && !o.exclusive && full;
      return `<button class="opt ${multi ? "multi" : ""} ${on ? "on" : ""} ${o.exclusive ? "none-opt" : ""}"
        data-act="opt" data-id="${esc(o.id)}" aria-pressed="${on}" ${disabled ? "disabled" : ""}>
        ${multi && !o.exclusive ? `<span class="check" aria-hidden="true"></span>` : ""}<span>${esc(o.label)}</span>
      </button>`;
    })
    .join("");
  const left = realMax - chosen.length;
  const hint = multi
    ? `<p class="hint">${realMax}つまで選べます${!chosen.length ? "" : left > 0 ? `（あと${left}つ）` : "（選び直すときは、選んだものをもう一度タップ）"}</p>`
    : "";
  const next =
    q.id === "good"
      ? `<button class="btn primary big sticky" data-act="next" ${chosen.length ? "" : "disabled"}>次へ</button>`
      : q.id === "concern"
        ? `<button class="btn primary big sticky" data-act="make" ${chosen.length ? "" : "disabled"}>この内容で文章を作る</button>`
        : "";
  return `${header({ back: st.step >= 1 })}
  <main class="page question">
    ${dots()}
    <h1 tabindex="-1">${esc(q.label)}</h1>
    ${hint}
    <div class="opts ${multi ? "grid" : ""}">${opts}</div>
    ${next}
  </main>`;
}

function viewGenerating() {
  return `${header()}
  <main class="page generating" aria-busy="true">
    <div class="spinner" aria-hidden="true"><span></span><span></span><span></span></div>
    <h1 tabindex="-1">文章を作っています…</h1>
  </main>`;
}

function viewDraft() {
  const text = currentText();
  const n = st.texts.length;
  const d = dest();
  const body = st.editing
    ? `<textarea class="draft-edit" data-input="draft" aria-label="下書きを編集" rows="8">${esc(text)}</textarea>`
    : `<p class="draft-text">${esc(text)}</p>`;
  return `${header()}
  <main class="page draft">
    <h1 tabindex="-1">口コミの下書きができました</h1>
    <div class="draft-card ${st.editing ? "editing" : ""}">
      ${body}
      <div class="draft-meta">
        <span class="count" data-count>${len(text)}字</span>
        ${n > 1 ? `<span class="variant">${st.idx + 1} / ${n}</span>` : ""}
      </div>
    </div>
    <div class="row">
      ${n > 1 ? `<button class="btn ghost" data-act="variant" ${st.editing ? "disabled" : ""}>別の言い方にする</button>` : ""}
      <button class="btn ghost" data-act="edit">${st.editing ? "編集を終える" : "編集"}</button>
    </div>
    <button class="btn primary big" data-act="post" ${len(text) ? "" : "disabled"}>この内容で${esc(d.name)}に投稿する</button>
    <p class="fineprint">AIが下書きを作成しました。実際のご体験に合うよう修正してください</p>
    <button class="text-btn center" data-act="redo">回答をやり直す</button>
  </main>`;
}

function pasteStep() {
  if (os === "ios") return `「ペースト」をタップ<small>出なければ、入力欄を長押し</small>`;
  if (os === "android") return `キーボードの上に出てくる文章をタップ`;
  return `貼り付け<small>Ctrl+V（Macは ⌘+V）</small>`;
}

function viewHandoff() {
  const d = dest();
  const status =
    st.copy === "ok"
      ? `<p class="copied ok" role="status"><span aria-hidden="true">✓</span> 文章をコピーしました</p>`
      : st.copy === "fail"
        ? `<p class="copied fail" role="status">自動でコピーできませんでした。下の文章を長押しして、コピーしてください</p>`
        : `<p class="copied" role="status">コピーしています…</p>`;
  return `${header()}
  <main class="page handoff">
    ${inAppBanner()}
    ${status}
    <h1 tabindex="-1">このあと開く画面で</h1>
    <ol class="steps">
      <li><span class="num">1</span><span>星を選ぶ</span></li>
      <li><span class="num">2</span><span>入力欄をタップ</span></li>
      <li><span class="num">3</span><span>${pasteStep()}</span></li>
      <li><span class="num">4</span><span>投稿する</span></li>
    </ol>
    <button class="btn primary big" data-act="open">${esc(d.name)}を開く</button>
    ${d.real ? "" : `<p class="fineprint">デモ設定で Place ID が未設定のため、Googleマップのトップが開きます（投稿画面は開きません）。</p>`}
    <section class="fallback">
      <h2>うまく貼り付けられないとき</h2>
      <p>下の文章を長押しして、コピーしてください。</p>
      <textarea class="fallback-text" readonly rows="6" aria-label="口コミの文章">${esc(currentText())}</textarea>
      <button class="btn ghost small" data-act="recopy">もう一度コピーする</button>
    </section>
    <div class="row spread">
      <button class="text-btn" data-act="backToDraft">‹ 文章を直す</button>
      <button class="text-btn" data-act="finish">終わった</button>
    </div>
  </main>`;
}

function viewThanks() {
  return `${header()}
  <main class="page thanks">
    <div class="thanks-mark" aria-hidden="true">✓</div>
    <h1 tabindex="-1">ご協力ありがとうございました</h1>
    <p class="muted">${esc(storeName())}</p>
    <button class="text-btn center" data-act="restart">最初の画面にもどる</button>
  </main>`;
}

// ---- 描画 -------------------------------------------------------------------

function render(focus = true) {
  const views: Record<Screen, () => string> = {
    landing: viewLanding,
    invalid: viewInvalid,
    intro: viewIntro,
    question: viewQuestion,
    generating: viewGenerating,
    draft: viewDraft,
    handoff: viewHandoff,
    thanks: viewThanks,
  };
  root.innerHTML = views[st.screen]();
  root.dataset.screen = st.screen;
  if (focus) {
    root.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}

function go(screen: Screen) {
  st.screen = screen;
  render();
}

// ---- 操作 -------------------------------------------------------------------

function openStore(store: Store) {
  document.title = `${store.name}｜アンケート`;
  st.store = store;
  st.cat = store.cat;
  st.answers = {};
  st.step = 0;
  st.screen = "intro";
}

function onOption(q: Question, id: string) {
  if (st.busy) return;
  const cur = st.answers[q.id] ?? [];
  if (q.type === "single") {
    st.answers[q.id] = [id];
    render(false);
    // タップした瞬間に次へ（選ばれたことが一瞬見えるだけ待つ）
    st.busy = true;
    setTimeout(() => {
      st.busy = false;
      st.step += 1;
      go("question");
    }, 180);
    return;
  }
  const opt = q.options.find((o) => o.id === id);
  if (opt?.exclusive) {
    // 「特にない」は他を外して即座に次へ（1タップで終われる）
    st.answers[q.id] = [id];
    render(false);
    st.busy = true;
    setTimeout(() => {
      st.busy = false;
      void makeDrafts();
    }, 180);
    return;
  }
  const without = cur.filter((x) => x !== NONE_ID);
  st.answers[q.id] = without.includes(id)
    ? without.filter((x) => x !== id)
    : without.length < q.maxSelect
      ? [...without, id]
      : without;
  render(false);
}

async function makeDrafts() {
  const cat = st.cat!;
  go("generating");
  const started = performance.now();
  // テンプレートモードでも少し待つ。即表示だとAIが書いたように見えない
  const minWait = 1100 + Math.random() * 700;
  const res = await generateDrafts(cat, st.answers, loadHistory());
  const rest = minWait - (performance.now() - started);
  if (rest > 0) await sleep(rest);
  if (st.screen !== "generating") return;
  pushHistory(res.drafts.map((d) => d.text));
  st.drafts = res.drafts;
  st.texts = res.drafts.map((d) => d.text);
  st.idx = 0;
  st.editing = false;
  go("draft");
}

function post() {
  const text = currentText().trim();
  if (!text) return;
  st.copy = "pending";
  st.opened = false;
  st.wentHidden = false;
  // ここで同期的にコピーする（await を先に挟まない）
  copyText(text, (ok) => {
    st.copy = ok ? "ok" : "fail";
    if (st.screen === "handoff") render(false);
  });
  go("handoff");
}

function openDestination() {
  // 元ページを残して別タブで開く。戻ってきたことを visibilitychange で拾う
  window.open(dest().url, "_blank", "noopener");
  st.opened = true;
}

function onClick(e: MouseEvent) {
  const el = (e.target as Element).closest<HTMLElement>("[data-act]");
  if (!el || (el as HTMLButtonElement).disabled) return;
  const act = el.dataset.act;
  switch (act) {
    case "openCustomer":
      void openCustomerDemo();
      break;
    case "restart":
      st.answers = {};
      st.step = 0;
      go("intro");
      break;
    case "start":
      st.step = 0;
      go("question");
      break;
    case "back":
      if (st.screen === "question" && st.step > 0) {
        st.step -= 1;
        go("question");
      }
      break;
    case "opt": {
      const q = st.cat!.questions[st.step];
      onOption(q, el.dataset.id ?? "");
      break;
    }
    case "next":
      st.step += 1;
      go("question");
      break;
    case "make":
      void makeDrafts();
      break;
    case "variant":
      st.idx = (st.idx + 1) % st.texts.length;
      render(false);
      break;
    case "edit":
      st.editing = !st.editing;
      render(false);
      if (st.editing) {
        const ta = root.querySelector<HTMLTextAreaElement>(".draft-edit");
        ta?.focus();
        ta?.setSelectionRange(ta.value.length, ta.value.length);
      }
      break;
    case "redo":
      st.step = 0;
      go("question");
      break;
    case "post":
      post();
      break;
    case "open":
      openDestination();
      break;
    case "recopy":
      copyText(currentText().trim(), (ok) => {
        st.copy = ok ? "ok" : "fail";
        render(false);
      });
      break;
    case "backToDraft":
      go("draft");
      break;
    case "finish":
      go("thanks");
      break;
  }
}

function onInput(e: Event) {
  const el = e.target as HTMLInputElement | HTMLTextAreaElement;
  const key = el.dataset.input;
  if (!key) return;
  if (key === "draft") {
    st.texts[st.idx] = el.value;
    const c = root.querySelector("[data-count]");
    if (c) c.textContent = `${len(el.value)}字`;
    const btn = root.querySelector<HTMLButtonElement>('[data-act="post"]');
    if (btn) btn.disabled = !len(el.value);
    return;
  }
}

function onVisibility() {
  if (st.screen !== "handoff" || !st.opened) return;
  if (document.visibilityState === "hidden") st.wentHidden = true;
  // 投稿フォームから戻ってきた。投稿できたかどうかは分からないので「ご協力ありがとうございました」
  else if (st.wentHidden) setTimeout(() => st.screen === "handoff" && go("thanks"), 400);
}

/** トップから開くお客さま用ページ。この端末の管理者ページの設定を使う */
async function openCustomerDemo() {
  const cat = "restaurant";
  const d = loadSavedStore() ?? draftFromPreset(cat, DEMO_STORES[cat]?.name ?? "");
  // hashchange でお店を読み込む。戻るボタンでトップに戻れるよう履歴に積む
  location.hash = `s=${await encodeStore(d)}`;
}

/**
 * URL からお店を決める。
 * - #s=... : 管理者ページが発行した店舗設定
 * - #/restaurant など : 業種のデモ店舗（プリセットのまま）
 */
async function routeFromHash() {
  const token = tokenFromHash(location.hash);
  if (token) {
    const d = await decodeStore(token);
    if (!d) {
      st.store = undefined;
      st.screen = "invalid";
      return;
    }
    openStore({ name: d.name || "こちらのお店", cat: toCategory(d), placeId: d.placeId });
    return;
  }
  const id = location.hash.replace(/^#\/?/, "");
  const cat = id ? findCategory(id) : undefined;
  if (cat) openStore({ name: DEMO_STORES[cat.id]?.name ?? "デモ店舗", cat, placeId: "" });
  else {
    st.store = undefined;
    st.screen = "landing";
  }
}

export async function mount(el: HTMLElement) {
  root = el;
  await routeFromHash();
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("hashchange", async () => {
    await routeFromHash();
    render();
  });
  render();
}
