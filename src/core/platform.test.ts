import { describe, expect, it } from "vitest";
import { destinationFor } from "./destination";
import { detectInAppBrowser, detectOS, lineExternalUrl } from "./platform";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const LINE = IPHONE + " Line/14.0.0";
const INSTAGRAM = ANDROID + " Instagram 300.0.0.0";

describe("platform", () => {
  it("OS", () => {
    expect(detectOS(IPHONE, 5)).toBe("ios");
    expect(detectOS(IPAD, 5)).toBe("ios");
    expect(detectOS(IPAD, 0)).toBe("other");
    expect(detectOS(ANDROID, 5)).toBe("android");
  });
  it("アプリ内ブラウザ", () => {
    expect(detectInAppBrowser(IPHONE)).toBeNull();
    expect(detectInAppBrowser(ANDROID)).toBeNull();
    expect(detectInAppBrowser(LINE)).toBe("line");
    expect(detectInAppBrowser(INSTAGRAM)).toBe("instagram");
  });
  it("LINE の外部ブラウザURLはハッシュを保つ", () => {
    expect(lineExternalUrl("https://x.github.io/repo/#/restaurant")).toBe("https://x.github.io/repo/?openExternalBrowser=1#/restaurant");
  });
});

describe("destination", () => {
  it("Place ID が無ければマップのトップ", () => {
    expect(destinationFor("")).toEqual({ name: "Google", url: "https://www.google.com/maps", real: false });
    expect(destinationFor("abc")).toMatchObject({ real: false });
  });
  it("Place ID があれば投稿フォーム", () => {
    const d = destinationFor(" ChIJN1t_tDeuEmsRUsoyG83frY4 ");
    expect(d.url).toBe("https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4");
    expect(d.real).toBe(true);
  });
  it("Place ID に URL を混ぜられない", () => {
    expect(destinationFor("abc&x=https://evil.example").real).toBe(false);
  });
});
