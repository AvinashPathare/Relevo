/** Child-process helpers for the demo: spawn with logs to .data/logs, wait until healthy, clean up. */
import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";

const children: ChildProcess[] = [];

export function startService(name: string, script: string, env: Record<string, string>): ChildProcess {
  mkdirSync(".data/logs", { recursive: true });
  const log = createWriteStream(`.data/logs/${name}.log`, { flags: "w" });
  const child = spawn(process.execPath, ["--import", "tsx", script], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
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

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopAll();
    process.exit(130);
  });
}
process.on("exit", stopAll);
