// 검증 페이지와 서버가 같은 경로로 판을 재생한다 — rooms-arch 결정 4.

export type Reducer<S, A> = (state: S, action: A) => S;

export function replay<S, A>(initial: S, reduce: Reducer<S, A>, log: readonly A[]): S {
  return log.reduce<S>((state, action) => reduce(state, action), initial);
}
