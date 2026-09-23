// 端末判定。貼り付け方の説明の出し分けと、アプリ内ブラウザの検知に使う。

export type OS = "ios" | "android" | "other";

export function detectOS(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints ?? 0): OS {
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  // iPadOS のSafariはMacのUAを名乗るのでタッチ点数で見分ける
  if (/Macintosh/i.test(ua) && touchPoints > 1) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

export type InAppBrowser = "line" | "instagram" | "facebook" | "x" | "tiktok" | "wechat" | "other" | null;

/** LINE・Instagram などのアプリ内ブラウザ。クリップボードやタブ制御が効かないことがある */
export function detectInAppBrowser(ua = navigator.userAgent): InAppBrowser {
  if (/\bLine\//i.test(ua)) return "line";
  if (/Instagram/i.test(ua)) return "instagram";
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return "facebook";
  if (/Twitter/i.test(ua)) return "x";
  if (/musical_ly|BytedanceWebview|TikTok/i.test(ua)) return "tiktok";
  if (/MicroMessenger/i.test(ua)) return "wechat";
  if (/; wv\)/.test(ua) && /Android/i.test(ua)) return "other";
  return null;
}

/** LINE は URL に openExternalBrowser=1 を付けると外部ブラウザで開き直せる */
export function lineExternalUrl(href = location.href): string {
  const u = new URL(href);
  u.searchParams.set("openExternalBrowser", "1");
  return u.toString();
}
