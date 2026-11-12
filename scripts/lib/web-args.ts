/** `pnpm exec next dev …` arguments: localhost only, so the proxied router and demo signer stay off the LAN. */
export function nextDevArgs(port: number): string[] {
  return ["exec", "next", "dev", "--hostname", "127.0.0.1", "--port", String(port)];
}
