/** pnpm gen:vectors — rewrites docs/receipts/vectors from scripts/lib/receipt-vectors.ts. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildVectors } from "./lib/receipt-vectors.ts";

const dir = "docs/receipts/vectors";
mkdirSync(dir, { recursive: true });
for (const [name, text] of Object.entries(buildVectors().files)) writeFileSync(join(dir, name), text);
console.log(`wrote ${dir}`);
