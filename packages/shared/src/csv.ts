/** Payee CSV: `name,clabe,amount_mxn`, at most 50 data rows. Rows are numbered from 2 (line 1 is the header). */
import { parse } from "csv-parse/sync";
import { validateClabe } from "./clabe.ts";

export interface PayeeRow {
  row: number;
  name: string;
  clabe: string;
  amount_mxn: string;
}

export interface RowError {
  row: number;
  reason: string;
}

export const MAX_ROWS = 50;
const AMOUNT = /^\d+(\.\d{1,2})?$/;

export function parsePayeeCsv(text: string): { rows: PayeeRow[]; errors: RowError[] } {
  let records: string[][];
  try {
    records = parse(text, { bom: true, relax_column_count: true, skip_empty_lines: true, trim: true });
  } catch {
    return { rows: [], errors: [{ row: 0, reason: "unparseable_csv" }] };
  }
  const [head, ...data] = records;
  const headerOk =
    head?.length === 3 && head.map((h) => h.toLowerCase()).join(",") === "name,clabe,amount_mxn";
  if (!headerOk) return { rows: [], errors: [{ row: 1, reason: "bad_header" }] };

  const errors: RowError[] = [];
  if (data.length > MAX_ROWS) errors.push({ row: 0, reason: "too_many_rows" });
  const rows: PayeeRow[] = [];
  const seen = new Set<string>();
  data.forEach((rec, i) => {
    const row = i + 2;
    const [name = "", clabe = "", amount_mxn = ""] = rec;
    let reason: string | null = null;
    if (rec.length !== 3) reason = "bad_column_count";
    else if (!name) reason = "missing_name";
    else if (!clabe) reason = "missing_clabe";
    else if (!amount_mxn) reason = "missing_amount";
    else if (!AMOUNT.test(amount_mxn) || Number(amount_mxn) <= 0) reason = "bad_amount";
    else {
      const c = validateClabe(clabe);
      if (!c.ok) reason = c.reason;
      else if (seen.has(clabe)) reason = "duplicate_clabe";
    }
    if (reason) errors.push({ row, reason });
    else {
      seen.add(clabe);
      rows.push({ row, name, clabe, amount_mxn });
    }
  });
  return { rows, errors };
}
