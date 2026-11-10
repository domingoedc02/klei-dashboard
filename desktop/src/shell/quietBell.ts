const QUIET: Record<string, unknown> = {
  '/api/v1/notifications': { items: [], unread: 0 },
  '/api/v1/dashboard': { aiStatus: { phase: 'idle' }, errors: [] },
};

/** Test helper: the Bell and the Dashboard read on mount and on a timer; answer both with nothing so screen tests keep their own request order. */
export function quietBell<T extends { request: (...a: never[]) => unknown }>(mocks: T): T {
  return {
    ...mocks,
    request: (m: string, p: string, ...a: unknown[]) =>
      p in QUIET && m === 'GET' ? Promise.resolve({ status: 200, body: QUIET[p] }) : (mocks.request as (...x: unknown[]) => unknown)(m, p, ...a),
  };
}
