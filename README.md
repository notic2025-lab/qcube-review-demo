# 口コミ下書き生成 — デモ

QRを読んだ来店客が4問のアンケートに答えると口コミの下書きが作られ、Googleの投稿フォームへ誘導される——その流れを見せる静的デモページ。

- 公開: GitHub Pages（`main` への push で GitHub Actions がデプロイ）
- 仕様と設計判断の理由: [PROMPT.md](PROMPT.md)

## 2つのページ

| ページ | URL | 使う人 |
| --- | --- | --- |
| お客さま用 | `https://<user>.github.io/<repo>/#s=...` | 来店客（QRから開く） |
| 管理者 | `https://<user>.github.io/<repo>/admin/` | お店・デモの説明者 |

サーバーも DB も無いので、**管理者ページで決めた設定（業種・店名・Google Place ID・アンケートの質問文と選択肢）は、お客さま用URLのハッシュ `#s=...` に圧縮して入れて渡す。**
設定を変えると URL も変わる。Q-CUBE（可変QR）にはこの URL を登録する。

- 管理者ページは編集中の内容をその端末の `localStorage` と自分の URL（`admin/#s=...`）に残す。URL を共有すれば別の端末でも続きを編集できる
- お客さま用ページは URL から来た値を必ず検査する（業種 ID・Place ID の形式・文字数・制御文字・禁止語・選択肢の数）。直せない部分はひな形に戻す
- 満足度・星の数を聞く質問文は管理者ページで作れない（レビューゲーティング防止）。「特にない」は Q4 の先頭に自動で付き、外せない
- お客さまの回答や生成文は管理者からは見えない（サーバーが無いため）
- 業種のひな形のまま試す: `https://<user>.github.io/<repo>/#/restaurant`（ID は `survey-presets.json` の `categories[].id`）

## 守っていること

- **自動投稿はしない。** 「生成 → 本人がコピー → 投稿フォームへ遷移 → 本人が貼って投稿」だけ
- **満足度で導線を分岐させない（レビューゲーティングをしない）。** 気になった点は選ばれたら必ず下書きに入れる
- **投稿できたかは検知できない。** 完了画面は「ご協力ありがとうございました」
- **同じ文章を量産しない。** 語り口12種・言い回しの乱数選択・直近20件と先頭30字が重なる案は作り直す

## 開発

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # 単体テスト
npm run samples   # 全業種 × 数パターンの生成結果を表示（SEED=1 CAT=hotel PER=5 で絞り込み）
npm run build
```

クリップボードの実機検証は GitHub Pages の URL（HTTPS）で行う。スマホから LAN 経由の http で開くと `navigator.clipboard` が存在しないため検証にならない。

## 構成

| パス | 内容 |
| --- | --- |
| `survey-presets.json` | 業種別アンケート（正本） |
| `src/core/presets.ts` | 正規化・「特にない」付与・回答のラベル解決 |
| `src/core/phrases.ts` | テンプレート生成用の言い回し辞書（選択肢ごと） |
| `src/core/template.ts` | テンプレート生成エンジン（語り口シード別） |
| `src/core/generate.ts` | 3案の生成と作り直し |
| `src/core/validate.ts` | 出力の検証（両モード共通） |
| `src/core/store-config.ts` | 店舗設定の検査・URL への変換（管理者 ↔ お客さま） |
| `src/app.ts` | お客さま用ページ |
| `src/admin/main.ts` | 管理者ページ（店舗設定・アンケート編集・URL と QR の発行） |
