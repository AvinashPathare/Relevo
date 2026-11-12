/**
 * `pnpm exec next dev …` arguments.
 * - localhost only, so the proxied router and demo signer stay off the LAN;
 * - webpack, not Turbopack: in this pnpm workspace Turbopack's dev watcher sees the app's own writes under
 *   apps/web/.next and reloads an open page in a loop (measured: ~4 reloads/s vs 0 with webpack).
 *   `next build` is unaffected.
 */
export function nextDevArgs(port: number): string[] {
  return ["exec", "next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)];
}
