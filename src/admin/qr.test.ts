import { expect, it } from "vitest";
import { qrSvg } from "./qr";

it("QRコードの SVG を作る", () => {
  const svg = qrSvg("https://notic2025-lab.github.io/qcube-review-demo/#s=zabc");
  expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 \d+ \d+"/);
  expect(svg).toContain('<path d="M');
});
