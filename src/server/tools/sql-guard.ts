/**
 * Guard for the `run_sql` tool.
 *
 * The SQL is parsed with the real Postgres parser (libpg-query). It must be a single
 * plain SELECT (CTEs allowed) that reads only allowlisted governed views, calls no
 * dangerous functions and takes no locks. It is then wrapped in a row limit and run in a
 * READ ONLY transaction as the agent_ro role with a statement timeout. The parse check is
 * the first layer; the database role is the backstop.
 */
import { parse } from 'libpg-query';

export const ALLOWED_VIEWS = [
  'v_stations', 'v_datasets', 'v_sales_period', 'v_sales_monthly', 'v_affordable_share',
  'v_patronage_monthly', 'v_land_use',
] as const;

export const VIEW_DATASET: Record<string, string | undefined> = {
  v_sales_period: 'sales',
  v_sales_monthly: 'sales',
  v_affordable_share: 'sales',
  v_patronage_monthly: 'patronage',
  v_land_use: 'land_use',
};

export const MAX_ROWS = 200;

const DENIED_FUNCTION = /^(pg_|lo_|dblink|set_config|current_setting|query_to_xml|table_to_xml|cursor_to_xml|xml|txid_|nextval|setval|currval|version$|inet_|has_.*_privilege)/i;

const DENIED_NODES = new Set([
  'RangeFunction', 'RangeTableFunc', 'RangeTableSample', 'LockingClause', 'IntoClause',
  'InsertStmt', 'UpdateStmt', 'DeleteStmt', 'MergeStmt', 'CopyStmt', 'CallStmt', 'DoStmt',
]);

export type GuardResult =
  | { ok: true; sql: string; views: string[] }
  | { ok: false; error: string };

type Node = Record<string, unknown>;

function walk(node: unknown, visit: (type: string, value: Node) => void): void {
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node as Node)) {
    if (/^[A-Z]/.test(key) && value && typeof value === 'object' && !Array.isArray(value)) visit(key, value as Node);
    walk(value, visit);
  }
}

function strings(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((x) => ((x as { String?: { sval?: string } }).String?.sval ?? '')).filter(Boolean);
}

export async function guardSql(input: string): Promise<GuardResult> {
  const sql = input.trim().replace(/;+\s*$/, '');
  if (!sql) return { ok: false, error: 'empty SQL' };
  if (sql.length > 4000) return { ok: false, error: 'SQL longer than 4000 characters' };

  let ast: { stmts?: { stmt: Node }[] };
  try {
    ast = (await parse(sql)) as typeof ast;
  } catch (e) {
    return { ok: false, error: `SQL does not parse: ${e instanceof Error ? e.message : String(e)}` };
  }
  const stmts = ast.stmts ?? [];
  if (stmts.length !== 1) return { ok: false, error: 'exactly one statement is allowed' };
  const top = stmts[0]!.stmt;
  if (!('SelectStmt' in top)) return { ok: false, error: `only SELECT is allowed (got ${Object.keys(top)[0]})` };

  const cteNames = new Set<string>();
  walk(top, (type, v) => {
    if (type === 'CommonTableExpr' && typeof v.ctename === 'string') cteNames.add(v.ctename);
  });

  const errors: string[] = [];
  const views = new Set<string>();
  walk(top, (type, v) => {
    if (DENIED_NODES.has(type)) errors.push(`${type} is not allowed`);
    if (type === 'SelectStmt' && (v.intoClause || v.lockingClause)) errors.push('SELECT INTO and locking clauses are not allowed');
    if (type === 'RangeVar') {
      const rel = String(v.relname ?? '');
      const schema = v.schemaname ? String(v.schemaname) : undefined;
      if (schema && schema !== 'public') errors.push(`schema ${schema} is not allowed`);
      if (cteNames.has(rel) && !schema) return;
      if ((ALLOWED_VIEWS as readonly string[]).includes(rel)) views.add(rel);
      else errors.push(`relation ${rel} is not allowed; use one of ${ALLOWED_VIEWS.join(', ')}`);
    }
    if (type === 'FuncCall') {
      const name = strings(v.funcname);
      const fn = name.at(-1) ?? '';
      if (name.length > 1 && name[0] !== 'pg_catalog') errors.push(`function ${name.join('.')} is not allowed`);
      if (DENIED_FUNCTION.test(fn)) errors.push(`function ${fn} is not allowed`);
    }
  });
  if (errors.length) return { ok: false, error: [...new Set(errors)].join('; ') };
  if (views.size === 0) return { ok: false, error: 'the query must read at least one governed view' };

  return { ok: true, sql: `select * from (\n${sql}\n) as governed_query limit ${MAX_ROWS}`, views: [...views] };
}
