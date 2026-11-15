// An in-memory stand-in for a Cloudflare D1 binding, on Node's built-in SQLite (node:sqlite), so
// the account tests run the real SQL of migrations/0002_accounts.sql offline. It implements the
// D1 calls the Worker uses: prepare(sql).bind(...).first() / .all() / .run(), and batch([...])
// (one transaction). Every INSERT/UPDATE/DELETE is counted in `writes`, so a test can check that
// a refused request wrote nothing. migrate: false gives an empty database (tables not created).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const MIGRATION = new URL('../migrations/0002_accounts.sql', import.meta.url);
const plain = row => (row ? { ...row } : null);

export function fakeD1({ migrate = true } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  if (migrate) sqlite.exec(readFileSync(MIGRATION, 'utf8'));
  const log = { writes: 0, statements: [] };
  const statement = (sql, params = []) => ({
    sql, params,
    bind: (...values) => statement(sql, values),
    async first() { log.statements.push(sql); return plain(sqlite.prepare(sql).get(...params)); },
    async all() { log.statements.push(sql); return { results: sqlite.prepare(sql).all(...params).map(plain), success: true, meta: {} }; },
    async run() {
      log.statements.push(sql);
      if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)) log.writes++;
      const r = sqlite.prepare(sql).run(...params);
      return { success: true, meta: { changes: Number(r.changes) } };
    }
  });
  return {
    prepare: sql => statement(sql),
    async batch(list) {
      sqlite.exec('BEGIN');
      try { const out = []; for (const s of list) out.push(await s.run()); sqlite.exec('COMMIT'); return out; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
    sqlite, log,
    rows: (sql, ...params) => sqlite.prepare(sql).all(...params).map(plain)
  };
}
