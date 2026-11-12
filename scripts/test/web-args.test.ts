import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { nextDevArgs } from "../lib/web-args.ts";

it("binds the dev web server to localhost only, on webpack (Turbopack's dev watcher reload-loops in this workspace)", () => {
  expect(nextDevArgs(3000)).toEqual([
    "exec",
    "next",
    "dev",
    "--webpack",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3000",
  ]);
  const pkg = JSON.parse(readFileSync(new URL("../../apps/web/package.json", import.meta.url), "utf8"));
  expect(pkg.scripts.dev).toContain("--hostname 127.0.0.1");
  expect(pkg.scripts.dev).toContain("--webpack");
  expect(pkg.scripts.start).toContain("--hostname 127.0.0.1");
});
