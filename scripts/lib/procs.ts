/** Child-process helpers for the demo: spawn with logs (default .data/logs), wait until healthy, clean up. */
import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";

const children: ChildProcess[] = [];
let logDir = ".data/logs";

/** Where service logs go. pnpm dev moves them out of the repo (see scripts/dev.ts). */
export function setLogDir(dir: string): void {
  logDir = dir;
}
const hooks: Array<() => Promise<void> | void> = [];

/** Runs on Ctrl-C / SIGTERM after the children are killed (e.g. tearing down the local sandbox). */
export function onStop(fn: () => Promise<void> | void): void {
  hooks.push(fn);
}

export function startService(name: string, script: string, env: Record<string, string>): ChildProcess {
  mkdirSync(logDir, { recursive: true });
  const log = createWriteStream(`${logDir}/${name}.log`, { flags: "w" });
  const child = spawn(process.execPath, ["--import", "tsx", script], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  children.push(child);
  return child;
}

/** Like startService, but for any command (used for `next dev`). */
export function startCommand(
  name: string,
  cmd: string,
  args: string[],
  env: Record<string, string>,
  cwd?: string,
): ChildProcess {
  mkdirSync(logDir, { recursive: true });
  const log = createWriteStream(`${logDir}/${name}.log`, { flags: "w" });
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, cwd, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  children.push(child);
  return child;
}

export async function waitHealthy(url: string, timeoutMs = 30_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`service at ${url} did not become healthy`);
}

export function stopAll(): void {
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
}

let stopping: Promise<void> | null = null;

/**
 * Kills the children, then runs the stop hooks (best effort, at most 5 s). Used on Ctrl-C and on the
 * failure path, so a failed start still tears down what it set up. Runs once; later calls wait for it.
 */
export function shutdown(): Promise<void> {
  stopping ??= (async () => {
    stopAll();
    const pending = hooks.map(async (h) => {
      try {
        await h();
      } catch {
        // best effort
      }
    });
    await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, 5_000).unref())]);
  })();
  return stopping;
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await shutdown();
    process.exit(130);
  });
}
process.on("exit", stopAll);
