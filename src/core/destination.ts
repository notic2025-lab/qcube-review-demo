// 投稿先。本文を投稿フォームに事前入力する手段は無い（writereview は placeid しか受け取らない）ので、
// ここではフォームを開くURLを作るだけ。貼り付けと投稿は本人が行う。

export interface Destination {
  name: string;
  url: string;
  /** 本物の投稿フォームが開くか */
  real: boolean;
}

const PLACE_ID = /^[A-Za-z0-9_-]{10,}$/;

export function isValidPlaceId(id: string): boolean {
  return PLACE_ID.test(id.trim());
}

export function destinationFor(placeId: string): Destination {
  const id = placeId.trim();
  if (isValidPlaceId(id)) {
    return { name: "Google", url: `https://search.google.com/local/writereview?placeid=${encodeURIComponent(id)}`, real: true };
  }
  // マップのトップが開くだけ。投稿はされない
  return { name: "Google", url: "https://www.google.com/maps", real: false };
}
