// 投稿先。本文を投稿フォームに事前入力する手段は無い（writereview は placeid しか受け取らない）ので、
// ここではフォームを開くURLを作るだけ。貼り付けと投稿は本人が行う。

export interface Destination {
  name: string;
  url: string;
  /** 本物の投稿フォームが開くか */
  real: boolean;
}

const PLACE_ID = /^[A-Za-z0-9_-]{10,}$/;

/**
 * デモの投稿先（依頼者の指定: 鈴与商事㈱）。管理者ページで Place ID を入れなければこれが使われる。
 * 本物の投稿フォームが開く。押しただけでは投稿されないが、本人が「投稿」を押せば実際に載る。
 */
export const DEMO_PLACE_ID = "ChIJe_RRuvlJGmARhwimiSBHBOo";
export const DEMO_PLACE_NAME = "鈴与商事㈱";

export function isValidPlaceId(id: string): boolean {
  return PLACE_ID.test(id.trim());
}

export function destinationFor(placeId: string): Destination {
  const id = isValidPlaceId(placeId.trim()) ? placeId.trim() : DEMO_PLACE_ID;
  // Googleマップの「クチコミを投稿」ダイアログ（星と入力欄）が開く
  return { name: "Google", url: `https://search.google.com/local/writereview?placeid=${encodeURIComponent(id)}`, real: true };
}
