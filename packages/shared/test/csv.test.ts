import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePayeeCsv } from "../src/csv.ts";

const sample = (f: string) => readFileSync(new URL(`../../../samples/${f}`, import.meta.url), "utf8");
const header = "name,clabe,amount_mxn\n";

describe("parsePayeeCsv", () => {
  it("parses the valid sample", () => {
    const r = parsePayeeCsv(sample("payees.csv"));
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(5);
    expect(r.rows[0]).toEqual({
      row: 2,
      name: "Lucía Fernández",
      clabe: "002010077777777771",
      amount_mxn: "37000.00",
    });
  });
  it("reports the bad CLABE in the error sample", () => {
    expect(parsePayeeCsv(sample("payees-with-error.csv")).errors).toEqual([
      { row: 5, reason: "clabe_check_digit" },
    ]);
  });
  it("parses BOM CRLF quotes", () => {
    const r = parsePayeeCsv('﻿name,clabe,amount_mxn\r\n"Cruz, Ana",002010077777777771,10.50\r\n\r\n');
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([{ row: 2, name: "Cruz, Ana", clabe: "002010077777777771", amount_mxn: "10.50" }]);
  });
  it("rejects more than 50 rows", () => {
    const rows = Array.from({ length: 51 }, () => "A,002010077777777771,1.00").join("\n");
    expect(parsePayeeCsv(header + rows).errors).toContainEqual({ row: 0, reason: "too_many_rows" });
  });
  it("flags duplicate CLABEs", () => {
    const r = parsePayeeCsv(`${header}A,002010077777777771,1.00\nB,002010077777777771,2.00\n`);
    expect(r.errors).toEqual([{ row: 3, reason: "duplicate_clabe" }]);
  });
  it("flags bad amounts and missing fields", () => {
    const r = parsePayeeCsv(
      `${header}A,002010077777777771,-5\nB,032180000118359719,1.234\n,646180005555555554,1\nC,,1\nD,072180009876543213,\n`,
    );
    expect(r.errors).toEqual([
      { row: 2, reason: "bad_amount" },
      { row: 3, reason: "bad_amount" },
      { row: 4, reason: "missing_name" },
      { row: 5, reason: "missing_clabe" },
      { row: 6, reason: "missing_amount" },
    ]);
  });
  it("rejects zero amounts", () => {
    expect(parsePayeeCsv(`${header}A,002010077777777771,0.00\n`).errors).toEqual([
      { row: 2, reason: "bad_amount" },
    ]);
  });
  it("rejects a bad header", () => {
    expect(parsePayeeCsv("who,account,pesos\nA,002010077777777771,1\n").errors).toEqual([
      { row: 1, reason: "bad_header" },
    ]);
  });
});
