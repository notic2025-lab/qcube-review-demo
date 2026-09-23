import "../style.css";
import "./admin.css";
import { DEMO_PLACE_ID, DEMO_PLACE_NAME, isValidPlaceId } from "../core/destination";
import type { QuestionId } from "../core/presets";
import { CATEGORIES, QUESTION_ORDER, findCategory } from "../core/presets";
import { CLAUDE_MODEL, ClaudeError, generateClaudeDrafts } from "../core/claude";
import type { Answers } from "../core/presets";
import type { AiSettings } from "../core/storage";
import { clearHistory, loadAiSettings, loadHistory, saveAiSettings } from "../core/storage";
import type { Issue, StoreDraft } from "../core/store-config";
import {
  LIMITS,
  checkStore,
  decodeStore,
  draftFromPreset,
  encodeStore,
  isQuestionEdited,
  loadSavedStore,
  resetQuestion,
  saveStore,
  storeUrl,
  toCategory,
  tokenFromHash,
} from "../core/store-config";
import { DEMO_STORES } from "../stores";
import { downloadPng, qrSvg, saveBlob } from "./qr";

// 管理者ページ。お店の設定とアンケートを編集し、お客さま用のURLとQRコードを発行する。
// サーバーは無いので、設定はすべてお客さま用URL（#s=...）に入れて渡す。
// 編集中の内容はこの端末の localStorage と、このページのURL（#s=...）に残す。

const QMETA: Record<QuestionId, { no: number; role: string; kind: string }> = {
  scene: { no: 1, role: "お客さまが何を利用したか。具体的な言葉が文章に入り、口コミが自然になります。", kind: "1つ選ぶ（タップで次へ）" },
  context: { no: 2, role: "来店の状況（だれと・目的・何回目など）。文章の書き出しに使います。", kind: "1つ選ぶ（タップで次へ）" },
  good: { no: 3, role: "よかったところ。選ばれたものが下書きの中心になります。", kind: "3つまで選ぶ" },
  concern: {
    no: 4,
    role: "気になったところ。選ばれたら下書きに必ず入ります（よい点だけの口コミは不自然に見え、評価で案内を分けることもしません）。",
    kind: "2つまで選ぶ",
  },
};

let d: StoreDraft;
let ai: AiSettings = loadAiSettings();
let root: HTMLElement;
let url = "";
let svg = "";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const customerBase = () => new URL(import.meta.env.BASE_URL, location.origin).toString();

// ---- 読み込み・保存 ---------------------------------------------------------------

async function load(): Promise<StoreDraft> {
  // 編集用URL（#s=...）で開いたら、その設定を編集する
  const token = tokenFromHash(location.hash);
  if (token) {
    const fromUrl = await decodeStore(token);
    if (fromUrl) return fromUrl;
  }
  const saved = loadSavedStore();
  if (saved) return saved;
  const cat = CATEGORIES[0].id;
  return draftFromPreset(cat, DEMO_STORES[cat]?.name ?? "");
}

function save() {
  saveStore(d);
}

// ---- 画面 -------------------------------------------------------------------

function viewStore() {
  const cats = CATEGORIES.map((c) => `<option value="${esc(c.id)}" ${c.id === d.cat ? "selected" : ""}>${esc(c.label)}</option>`).join("");
  return `<section class="card" aria-labelledby="h-store">
    <h2 id="h-store">お店の設定</h2>
    <label class="field">
      <span class="field-label">業種</span>
      <select data-act-change="cat">${cats}</select>
      <span class="field-help">業種ごとのアンケートのひな形と、文章の言い回しが切り替わります。</span>
    </label>
    <label class="field">
      <span class="field-label">店名</span>
      <input type="text" data-bind="name" value="${esc(d.name)}" maxlength="${LIMITS.name}" autocomplete="off">
      <span class="issue" data-issue="name"></span>
    </label>
    <label class="field">
      <span class="field-label">投稿先：Google Place ID</span>
      <input type="text" data-bind="placeId" value="${esc(d.placeId)}" placeholder="空欄ならデモの投稿先（${DEMO_PLACE_NAME}）" autocomplete="off" autocapitalize="off" spellcheck="false">
      <span class="issue" data-issue="placeId"></span>
      <span class="field-help">${d.placeId.trim() === DEMO_PLACE_ID ? `いまはデモの投稿先（${DEMO_PLACE_NAME}）です。` : ""}<a href="https://developers.google.com/maps/documentation/places/web-service/place-id" target="_blank" rel="noopener">Place ID の調べ方</a>。入れると、お客さまの「Googleを開く」で口コミの投稿フォームが開きます。</span>
      <p class="danger-note">実在する店舗のPlace IDを入れると、本当に口コミが投稿できてしまいます。投稿しても差し支えない場所を指定してください。</p>
    </label>
  </section>`;
}

function viewQuestion(qid: QuestionId) {
  const q = d.questions[qid];
  const m = QMETA[qid];
  const rows = q.options
    .map(
      (o, i) => `<li class="opt-row">
        <input type="text" data-bind="${qid}.options.${i}" value="${esc(o.label)}" maxlength="${LIMITS.optionLabel}" aria-label="選択肢${i + 1}">
        <button class="icon-btn sm" data-act="up" data-q="${qid}" data-i="${i}" aria-label="上へ" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="icon-btn sm" data-act="down" data-q="${qid}" data-i="${i}" aria-label="下へ" ${i === q.options.length - 1 ? "disabled" : ""}>↓</button>
        <button class="icon-btn sm del" data-act="del" data-q="${qid}" data-i="${i}" aria-label="削除" ${q.options.length <= LIMITS.min[qid] ? "disabled" : ""}>×</button>
        <span class="issue" data-issue="${qid}.options.${i}"></span>
      </li>`,
    )
    .join("");
  const full = q.options.length >= LIMITS.max[qid];
  return `<section class="card q-card" aria-labelledby="h-${qid}">
    <div class="q-head">
      <h3 id="h-${qid}">質問${m.no}<span class="q-kind">${esc(m.kind)}</span></h3>
      <span class="badge" data-edited="${qid}" ${isQuestionEdited(d, qid) ? "" : "hidden"}>編集済み</span>
      <button class="text-btn" data-act="reset" data-q="${qid}" ${isQuestionEdited(d, qid) ? "" : "hidden"}>ひな形に戻す</button>
    </div>
    <p class="field-help">${esc(m.role)}</p>
    <label class="field">
      <span class="field-label">質問文</span>
      <input type="text" data-bind="${qid}.label" value="${esc(q.label)}" maxlength="${LIMITS.questionLabel}">
      <span class="issue" data-issue="${qid}.label"></span>
    </label>
    <div class="field">
      <span class="field-label">選択肢（${q.options.length}／最大${LIMITS.max[qid]}）</span>
      ${qid === "concern" ? `<p class="fixed-opt">特にない <small>自動で先頭に付きます。選ぶと1タップで終わります</small></p>` : ""}
      <ol class="opt-list">${rows}</ol>
      <span class="issue" data-issue="${qid}.options"></span>
      <div class="add-row">
        <input type="text" data-add="${qid}" maxlength="${LIMITS.optionLabel}" placeholder="${full ? "これ以上は追加できません" : "選択肢を追加"}" ${full ? "disabled" : ""}>
        <button class="btn small" data-act="add" data-q="${qid}" ${full ? "disabled" : ""}>追加</button>
      </div>
    </div>
  </section>`;
}

function viewAi() {
  return `<section class="card" aria-labelledby="h-ai">
    <h2 id="h-ai">AI生成（Claude Haiku 4.5）</h2>
    <p class="field-help">オンにすると、<strong>この端末で</strong>お客さま画面を開いたときに Claude が下書きを書きます。オフのとき・キーが無いとき・失敗したときは、テンプレートで作ります。</p>
    <label class="toggle field">
      <span class="field-label">Claude で文章を作る</span>
      <input type="checkbox" data-ai="enabled" ${ai.enabled ? "checked" : ""}>
    </label>
    <label class="field">
      <span class="field-label">Anthropic APIキー</span>
      <input type="password" data-ai="apiKey" placeholder="sk-ant-…" autocomplete="off" autocapitalize="off" spellcheck="false">
    </label>
    <p class="danger-note">キーはこの端末のブラウザにだけ保存されます。共有端末では使わないでください。</p>
    <p class="field-help">キーはお客さま用URLには入りません。お客さまのスマホで開いたときはテンプレートで作られます。</p>
    <div class="row">
      <button class="btn small" data-act="aiTest">試しに作ってみる</button>
      <button class="btn ghost small" data-act="aiClear">キーを消す</button>
    </div>
    <div class="ai-result" data-ai-result aria-live="polite"></div>
  </section>`;
}

/** 管理者ページの回答例（各設問の先頭の選択肢）で Claude に3案作らせる */
async function aiTest(btn: HTMLButtonElement) {
  const out = root.querySelector<HTMLElement>("[data-ai-result]")!;
  if (!ai.apiKey.trim()) {
    out.innerHTML = `<p class="issue">APIキーを入れてください</p>`;
    return;
  }
  const cat = toCategory(d);
  const [q1, q2, q3, q4] = cat.questions;
  const answers: Answers = {
    scene: [q1.options[0].id],
    context: [q2.options[0].id],
    good: q3.options.slice(0, 2).map((o) => o.id),
    concern: [q4.options[1].id],
  };
  btn.disabled = true;
  out.innerHTML = `<p class="muted small">${esc(CLAUDE_MODEL)} で作っています…</p>`;
  try {
    const drafts = await generateClaudeDrafts(cat, answers, { apiKey: ai.apiKey.trim(), storeName: d.name, history: [] });
    const labels = [q1.options[0].label, q2.options[0].label, ...q3.options.slice(0, 2).map((o) => o.label), `気になった: ${q4.options[1].label}`];
    out.innerHTML = `<p class="ok-note">接続できました。回答例: ${esc(labels.join(" / "))}</p>
      <ol class="ai-drafts">${drafts.map((x) => `<li>${esc(x.text)}<small>${[...x.text].length}字</small></li>`).join("")}</ol>`;
  } catch (e) {
    out.innerHTML = `<p class="issue">${esc(e instanceof ClaudeError ? e.message : "作れませんでした")}</p>`;
  } finally {
    btn.disabled = false;
  }
}

function viewPanel() {
  return `<section class="card panel" aria-labelledby="h-issue">
    <h2 id="h-issue">お客さま用URL・QRコード</h2>
    <div data-panel></div>
    <p class="field-help">設定はURLの中に入っています。内容を変えるとURLも変わるので、QRコードを作り直してください。Q-CUBE（可変QR）を使う場合は、このURLを登録し直すだけで、印刷済みのQRコードはそのまま使えます。</p>
  </section>`;
}

function panelBody(issues: Issue[]) {
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length) {
    return `<div class="panel-errors" role="alert">
      <strong>直すところがあります（${errors.length}件）</strong>
      <ul>${errors.map((e) => `<li><a href="#" data-jump="${esc(e.path)}">${esc(labelOf(e.path))}</a>：${esc(e.message)}</li>`).join("")}</ul>
    </div>`;
  }
  if (!url) return `<p class="muted">URLを作っています…</p>`;
  const warns = issues.filter((i) => i.level === "warn");
  return `${warns.map((w) => `<p class="warn-note">${esc(w.message)}</p>`).join("")}
    <div class="qr" aria-label="お客さま用URLのQRコード">${svg}</div>
    <label class="field">
      <span class="field-label">お客さま用URL</span>
      <input type="text" readonly value="${esc(url)}" data-url>
    </label>
    <div class="btn-grid">
      <button class="btn primary" data-act="copyUrl">URLをコピー</button>
      <a class="btn" href="${esc(url)}" target="_blank" rel="noopener">お客さま画面を開く</a>
      <button class="btn ghost small" data-act="png">QRをPNGで保存</button>
      <button class="btn ghost small" data-act="svg">QRをSVGで保存</button>
    </div>`;
}

function labelOf(path: string) {
  const [qid, part, i] = path.split(".");
  if (qid === "name") return "店名";
  if (qid === "placeId") return "Place ID";
  if (qid === "cat") return "業種";
  const no = QMETA[qid as QuestionId]?.no ?? "";
  if (part === "label") return `質問${no}の質問文`;
  if (i !== undefined) return `質問${no}の選択肢${Number(i) + 1}`;
  return `質問${no}の選択肢`;
}

function render() {
  root.innerHTML = `<header class="admin-head">
    <div>
      <a class="top-link" href="${import.meta.env.BASE_URL}">‹ トップ</a>
      <p class="eyebrow">管理者ページ</p>
      <h1>口コミ下書き｜お店の設定</h1>
      <p class="muted">ここで決めた内容が、お客さま用のURLとQRコードに入ります。編集中の内容はこの端末に保存されます。</p>
      <button class="btn small jump-link" data-act="toPanel">URL・QRコードを見る ↓</button>
    </div>
  </header>
  <div class="admin-grid">
    <div class="admin-main">
      ${viewStore()}
      <h2 class="section-title">アンケート</h2>
      <p class="muted small">4問の形（1つ選ぶ・複数選ぶ）は変えられません。質問文と選択肢を、お店に合わせて直せます。満足度や星の数を聞く質問は作れません。</p>
      ${QUESTION_ORDER.map(viewQuestion).join("")}
      <section class="card" aria-labelledby="h-hist">
        <h2 id="h-hist">この端末の生成履歴</h2>
        <p class="field-help">同じ文章が続かないよう、直近20件の下書きと書き出しが重ならないようにしています。この端末でお客さま画面を試したときの履歴だけが対象です（いま <span data-hist>${loadHistory().length}</span> 件）。</p>
        <button class="btn ghost small" data-act="clearHistory">履歴をクリア</button>
      </section>
    </div>
    <aside class="admin-side">${viewPanel()}${viewAi()}</aside>
  </div>`;
  const key = root.querySelector<HTMLInputElement>('[data-ai="apiKey"]');
  if (key) key.value = ai.apiKey;
  void update();
}

// ---- 反映 -------------------------------------------------------------------

let seq = 0;

/** 入力のたびに、検査結果・編集済み表示・URL・QRを更新する */
async function update() {
  save();
  const issues = checkStore(d);
  root.querySelectorAll<HTMLElement>("[data-issue]").forEach((el) => (el.textContent = ""));
  root.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
  for (const i of issues) {
    const el = root.querySelector<HTMLElement>(`[data-issue="${i.path}"]`);
    if (el) {
      el.textContent = i.message;
      el.dataset.level = i.level;
    }
    root.querySelector(`[data-bind="${i.path}"]`)?.setAttribute("aria-invalid", "true");
  }
  for (const qid of QUESTION_ORDER) {
    const edited = isQuestionEdited(d, qid);
    root.querySelector<HTMLElement>(`[data-edited="${qid}"]`)?.toggleAttribute("hidden", !edited);
    root.querySelector<HTMLElement>(`[data-act="reset"][data-q="${qid}"]`)?.toggleAttribute("hidden", !edited);
  }

  const my = ++seq;
  if (!issues.some((i) => i.level === "error")) {
    const token = await encodeStore(d);
    if (my !== seq) return;
    url = storeUrl(customerBase(), token);
    try {
      svg = qrSvg(url);
    } catch (e) {
      svg = `<p class="issue">${esc((e as Error).message)}</p>`;
    }
    // このページのURLにも同じ設定を入れておく（ブックマークすれば続きから編集できる）
    history.replaceState(null, "", `${location.pathname}#s=${token}`);
  } else {
    url = "";
  }
  const panel = root.querySelector<HTMLElement>("[data-panel]");
  if (panel) {
    const focused = document.activeElement;
    const keep = focused && panel.contains(focused);
    panel.innerHTML = panelBody(issues);
    if (keep) panel.querySelector<HTMLElement>("[data-act='copyUrl']")?.focus();
  }
}

let timer = 0;
const updateSoon = () => {
  clearTimeout(timer);
  timer = window.setTimeout(() => void update(), 120);
};

// ---- 操作 -------------------------------------------------------------------

function setByPath(path: string, value: string) {
  if (path === "name") d.name = value;
  else if (path === "placeId") d.placeId = value;
  else {
    const [qid, part, i] = path.split(".") as [QuestionId, string, string?];
    const q = d.questions[qid];
    if (part === "label") q.label = value;
    else if (part === "options" && i !== undefined) q.options[Number(i)].label = value;
  }
}

function addOption(qid: QuestionId) {
  const input = root.querySelector<HTMLInputElement>(`[data-add="${qid}"]`);
  const label = input?.value.trim() ?? "";
  if (!label || d.questions[qid].options.length >= LIMITS.max[qid]) return;
  d.questions[qid].options.push({ label });
  render();
  root.querySelector<HTMLInputElement>(`[data-add="${qid}"]`)?.focus();
}

function moveOption(qid: QuestionId, i: number, delta: number) {
  const opts = d.questions[qid].options;
  const j = i + delta;
  if (j < 0 || j >= opts.length) return;
  [opts[i], opts[j]] = [opts[j], opts[i]];
  render();
  root.querySelector<HTMLElement>(`[data-act="${delta < 0 ? "up" : "down"}"][data-q="${qid}"][data-i="${j}"]`)?.focus();
}

function changeCategory(catId: string, select: HTMLSelectElement) {
  if (!findCategory(catId)) return;
  const edited = QUESTION_ORDER.some((q) => isQuestionEdited(d, q));
  if (edited && !confirm("業種を変えると、アンケートの編集内容はひな形に戻ります。よろしいですか？")) {
    select.value = d.cat;
    return;
  }
  const oldDemo = DEMO_STORES[d.cat]?.name;
  const name = !d.name.trim() || d.name === oldDemo ? (DEMO_STORES[catId]?.name ?? "") : d.name;
  d = { ...draftFromPreset(catId, name), placeId: d.placeId };
  render();
}

async function onClick(e: MouseEvent) {
  const jump = (e.target as Element).closest<HTMLElement>("[data-jump]");
  if (jump) {
    e.preventDefault();
    const el = root.querySelector<HTMLElement>(`[data-bind="${jump.dataset.jump}"]`) ?? root.querySelector<HTMLElement>(`[data-issue="${jump.dataset.jump}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    if (el instanceof HTMLInputElement) el.focus({ preventScroll: true });
    return;
  }
  const el = (e.target as Element).closest<HTMLElement>("[data-act]");
  if (!el || (el as HTMLButtonElement).disabled) return;
  const qid = el.dataset.q as QuestionId;
  const i = Number(el.dataset.i);
  switch (el.dataset.act) {
    case "add":
      addOption(qid);
      break;
    case "del":
      if (d.questions[qid].options.length > LIMITS.min[qid]) {
        d.questions[qid].options.splice(i, 1);
        render();
      }
      break;
    case "up":
      moveOption(qid, i, -1);
      break;
    case "down":
      moveOption(qid, i, 1);
      break;
    case "reset":
      d = resetQuestion(d, qid);
      render();
      break;
    case "copyUrl":
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        el.textContent = "コピーしました";
      } catch {
        root.querySelector<HTMLInputElement>("[data-url]")?.select();
        el.textContent = "選択しました。コピーしてください";
      }
      setTimeout(() => (el.textContent = "URLをコピー"), 2000);
      break;
    case "png":
      if (url) await downloadPng(svg, `qr-${d.cat}.png`);
      break;
    case "svg":
      if (url) saveBlob(new Blob([svg], { type: "image/svg+xml" }), `qr-${d.cat}.svg`);
      break;
    case "aiTest":
      await aiTest(el as HTMLButtonElement);
      break;
    case "aiClear": {
      ai = { enabled: false, apiKey: "" };
      saveAiSettings(ai);
      const key = root.querySelector<HTMLInputElement>('[data-ai="apiKey"]');
      if (key) key.value = "";
      const on = root.querySelector<HTMLInputElement>('[data-ai="enabled"]');
      if (on) on.checked = false;
      root.querySelector("[data-ai-result]")!.innerHTML = `<p class="ok-note">キーを消しました</p>`;
      break;
    }
    case "toPanel":
      root.querySelector(".panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      break;
    case "clearHistory": {
      clearHistory();
      const h = root.querySelector("[data-hist]");
      if (h) h.textContent = "0";
      el.textContent = "クリアしました";
      break;
    }
  }
}

function onInput(e: Event) {
  const el = e.target as HTMLInputElement;
  if (el.dataset.ai) {
    ai = el.dataset.ai === "enabled" ? { ...ai, enabled: el.checked } : { ...ai, apiKey: el.value.trim() };
    saveAiSettings(ai);
    return;
  }
  if (el.dataset.bind) {
    setByPath(el.dataset.bind, el.value);
    updateSoon();
  }
}

function onKeydown(e: KeyboardEvent) {
  const el = e.target as HTMLInputElement;
  if (e.key === "Enter" && el.dataset.add && !e.isComposing) {
    e.preventDefault();
    addOption(el.dataset.add as QuestionId);
  }
}

function onChange(e: Event) {
  const el = e.target as HTMLSelectElement;
  if (el.dataset.actChange === "cat") changeCategory(el.value, el);
  if (el.dataset.bind === "placeId") {
    el.value = el.value.trim();
    setByPath("placeId", el.value);
    if (isValidPlaceId(el.value)) void update();
  }
}

async function main() {
  root = document.getElementById("admin")!;
  d = await load();
  root.addEventListener("click", (e) => void onClick(e));
  root.addEventListener("input", onInput);
  root.addEventListener("keydown", onKeydown);
  root.addEventListener("change", onChange);
  render();
}

void main();
