// 방 종류 이름 — 방 목록·방 제목에 같은 이름을 쓴다 (sutda3-arch.md 결정 4).
export const GAME_LABEL: Record<string, string> = {
  sutda: "2장 섯다",
  sutda3: "3장 섯다",
  poker7: "7포커",
  blackjack: "블랙잭",
  holdem: "홀덤",
};

export const gameLabel = (kind: string) => GAME_LABEL[kind] ?? kind;
