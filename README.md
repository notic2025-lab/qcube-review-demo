# 口コミ下書き生成 — デモ

QRを読んだ来店客が4問のアンケートに答えると口コミの下書きが作られ、Googleの投稿フォームへ誘導される——その流れを見せる静的デモページ。

- 公開: GitHub Pages（`main` への push で GitHub Actions がデプロイ）
- 業種を指定して開く: `https://<user>.github.io/<repo>/#/restaurant`（ID は `survey-presets.json` の `categories[].id`）
- 仕様と設計判断の理由: [PROMPT.md](PROMPT.md)

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
| `src/app.ts` | 画面 |
