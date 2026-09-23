import { destinationFor, isValidPlaceId } from "./core/destination";
import { generateDrafts } from "./core/engine";
import type { Draft } from "./core/generate";
import { detectInAppBrowser, detectOS, lineExternalUrl } from "./core/platform";
import type { Answers, Category, Question } from "./core/presets";
import { CATEGORIES, NONE_ID, findCategory } from "./core/presets";
import type { Settings } from "./core/storage";
import { HISTORY_SIZE, clearHistory, loadHistory, loadSettings, pushHistory, saveSettings } from "./core/storage";
import { DEMO_STORES } from "./stores";

// 画面は1枚。状態を持って描き直すだけのシンプルな状態遷移にしている。
//
// 設計上の前提（崩さないこと）:
// - 自動投稿はしない・できない。「生成 → 本人がコピー → 投稿フォームへ遷移 → 本人が貼って投稿」だけ
// - 満足度で導線を分岐させない（レビューゲーティング禁止）。何を選んでも同じ下書き画面・同じ投稿導線
// - 投稿できたかは検知できない。完了画面は「ご協力ありがとうございました」

type Screen = "home" | "intro" | "question" | "generating" | "draft" | "handoff" | "thanks";

interface State {
  screen: Screen;
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
  settingsOpen: boolean;
  busy: boolean;
}

const st: State = {
  screen: "home",
  step: 0,
  answers: {},
  drafts: [],
  texts: [],
  idx: 0,
  editing: false,
  copy: null,
  opened: false,
  wentHidden: false,
  settingsOpen: false,
  busy: false,
};
let settings: Settings = loadSettings();
const os = detectOS();
const inApp = detectInAppBrowser();

let root: HTMLElement;

// ---- helpers ----------------------------------------------------------------

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const storeName = () => settings.storeName.trim() || (st.cat ? DEMO_STORES[st.cat.id]?.name : "") || "デモ店舗";
const dest = () => destinationFor(settings.placeId);
const currentText = () => st.texts[st.idx] ?? "";
const len = (s: string) => [...s.trim()].length;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setHash(h: string) {
  history.replaceState(null, "", `${location.pathname}${location.search}#/${h}`);
}

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

const gear = `<button class="icon-btn gear" data-act="settings" aria-label="デモ設定"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1l-.4-2.6h-4l-.4 2.6c-.6.3-1.2.6-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.7 1.7 1l.4 2.6h4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4-2-1.6ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"/></svg></button>`;

function header(opts: { back?: boolean } = {}) {
  return `<header class="bar">
    ${opts.back ? `<button class="text-btn back" data-act="back">‹ もどる</button>` : `<span></span>`}
    <span class="bar-store">${st.cat ? esc(storeName()) : ""}</span>
    ${gear}
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

function viewHome() {
  const cards = CATEGORIES.map((c) => {
    const s = DEMO_STORES[c.id];
    return `<button class="cat-card" data-act="cat" data-id="${esc(c.id)}">
      <span class="cat-mark" aria-hidden="true">${esc(s?.mark ?? "店")}</span>
      <span class="cat-text"><span class="cat-label">${esc(c.label)}</span><span class="cat-store">${esc(s?.name ?? "")}</span></span>
    </button>`;
  }).join("");
  return `<header class="bar"><span></span><span></span>${gear}</header>
  <main class="page home">
    <p class="eyebrow">デモ</p>
    <h1 tabindex="-1">口コミ下書き生成</h1>
    <p class="lead">QRを読んだお客さまが4つの質問に答えると、口コミの下書きができあがり、投稿画面へ案内されます。業種を選ぶと、その業種のデモ店舗で体験できます。</p>
    <div class="cat-grid">${cards}</div>
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
    <button class="text-btn center" data-act="home">業種をえらびなおす</button>
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
    <button class="btn ghost" data-act="home">デモの最初にもどる</button>
  </main>`;
}

function viewSettings() {
  if (!st.settingsOpen) return "";
  const pid = settings.placeId.trim();
  const pidState = !pid ? "" : isValidPlaceId(pid) ? `<p class="ok-note">投稿フォームを開きます</p>` : `<p class="err-note">Place ID の形式ではありません（マップのトップを開きます）</p>`;
  return `<div class="sheet-backdrop" data-act="closeSettings"></div>
  <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <div class="sheet-head">
      <h2 id="settings-title">デモ設定</h2>
      <button class="icon-btn" data-act="closeSettings" aria-label="閉じる">×</button>
    </div>
    <p class="sheet-note">設定はこの端末のブラウザにだけ保存されます。</p>

    <label class="field">
      <span class="field-label">店名</span>
      <input type="text" data-input="storeName" value="${esc(settings.storeName)}" placeholder="空欄なら「〇〇（デモ）」" autocomplete="off">
    </label>

    <label class="field">
      <span class="field-label">投稿先：Google Place ID</span>
      <input type="text" data-input="placeId" value="${esc(settings.placeId)}" placeholder="空欄ならGoogleマップのトップを開く" autocomplete="off" autocapitalize="off" spellcheck="false">
      <span data-pid-state>${pidState}</span>
      <p class="danger-note">実在する店舗のPlace IDを入れると、本当に口コミが投稿できてしまいます。投稿しても差し支えない場所を指定してください。</p>
    </label>

    <div class="field">
      <span class="field-label">量産防止の履歴</span>
      <p class="sheet-note">直近${HISTORY_SIZE}件の生成文と書き出しが重ならないようにしています（いま <span data-hist>${loadHistory().length}</span> 件）。</p>
      <button class="btn ghost small" data-act="clearHistory">直近の生成文をクリア</button>
    </div>
  </section>`;
}

// ---- 描画 -------------------------------------------------------------------

function render(focus = true) {
  const views: Record<Screen, () => string> = {
    home: viewHome,
    intro: viewIntro,
    question: viewQuestion,
    generating: viewGenerating,
    draft: viewDraft,
    handoff: viewHandoff,
    thanks: viewThanks,
  };
  root.innerHTML = views[st.screen]() + viewSettings();
  root.dataset.screen = st.screen;
  if (st.settingsOpen) {
    root.querySelector<HTMLInputElement>(".sheet input")?.focus({ preventScroll: true });
  } else if (focus) {
    root.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}

function go(screen: Screen) {
  st.screen = screen;
  render();
}

// ---- 操作 -------------------------------------------------------------------

function startCategory(cat: Category) {
  st.cat = cat;
  st.answers = {};
  st.step = 0;
  setHash(cat.id);
  go("intro");
}

function toHome() {
  st.cat = undefined;
  st.answers = {};
  setHash("");
  go("home");
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
  const res = await generateDrafts(cat, st.answers, settings, loadHistory());
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
    case "settings":
      st.settingsOpen = true;
      render(false);
      break;
    case "closeSettings":
      st.settingsOpen = false;
      render(false);
      break;
    case "clearHistory": {
      clearHistory();
      const h = root.querySelector("[data-hist]");
      if (h) h.textContent = "0";
      el.textContent = "クリアしました";
      break;
    }
    case "cat": {
      const cat = findCategory(el.dataset.id ?? "");
      if (cat) startCategory(cat);
      break;
    }
    case "home":
      toHome();
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
  if (key === "storeName" || key === "placeId") {
    settings = { ...settings, [key]: el.value };
    saveSettings(settings);
    if (key === "placeId") {
      const pid = el.value.trim();
      const out = root.querySelector("[data-pid-state]");
      if (out)
        out.innerHTML = !pid
          ? ""
          : isValidPlaceId(pid)
            ? `<p class="ok-note">投稿フォームを開きます</p>`
            : `<p class="err-note">Place ID の形式ではありません（マップのトップを開きます）</p>`;
    }
    if (key === "storeName") {
      const bar = root.querySelector(".bar-store");
      if (bar && st.cat) bar.textContent = storeName();
    }
  }
}

function onVisibility() {
  if (st.screen !== "handoff" || !st.opened) return;
  if (document.visibilityState === "hidden") st.wentHidden = true;
  // 投稿フォームから戻ってきた。投稿できたかどうかは分からないので「ご協力ありがとうございました」
  else if (st.wentHidden) setTimeout(() => st.screen === "handoff" && go("thanks"), 400);
}

/** #/restaurant のように業種を指定して開けば、その業種の入口から始まる（QRに直接載せられる） */
function routeFromHash() {
  const id = location.hash.replace(/^#\/?/, "");
  const cat = id ? findCategory(id) : undefined;
  if (cat && cat !== st.cat) {
    st.cat = cat;
    st.answers = {};
    st.step = 0;
    st.screen = "intro";
  } else if (!id) {
    st.cat = undefined;
    st.screen = "home";
  }
}

export function mount(el: HTMLElement) {
  root = el;
  routeFromHash();
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("hashchange", () => {
    routeFromHash();
    render();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && st.settingsOpen) {
      st.settingsOpen = false;
      render(false);
    }
  });
  render();
}
