// 본인 시점 필터 — rooms-arch 결정 3. 상태 응답은 반드시 이 함수들을 거친다.

export type HeldCard<C> = {
  ownerId: string;
  faceUp: boolean;
  card: C;
};

export type VisibleCard<C> = {
  ownerId: string;
  faceUp: boolean;
  card: C | null;
};

export function maskCards<C>(cards: readonly HeldCard<C>[], viewerId: string | null): VisibleCard<C>[] {
  return cards.map((c) => ({
    ownerId: c.ownerId,
    faceUp: c.faceUp,
    card: c.faceUp || (viewerId !== null && c.ownerId === viewerId) ? c.card : null,
  }));
}

export function stripSecrets<S extends { secrets?: unknown }>(state: S): Omit<S, "secrets"> {
  const { secrets: _secrets, ...rest } = state;
  void _secrets;
  return rest;
}
