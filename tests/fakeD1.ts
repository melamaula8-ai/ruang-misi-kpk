// Adaptor D1 palsu di atas SQLite sungguhan (node:sqlite) agar logika server diuji dengan SQL asli.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import type { D1Like, D1Stmt, D1Result } from '../server/core';

class Stmt implements D1Stmt {
  private params: unknown[] = [];
  constructor(private db: DatabaseSync, private sql: string) {}
  bind(...values: unknown[]) { this.params = values; return this; }
  async all<T = any>() { return { results: this.db.prepare(this.sql).all(...(this.params as any[])) as T[] }; }
  async first<T = any>() { return (this.db.prepare(this.sql).get(...(this.params as any[])) as T) ?? null; }
  async run(): Promise<D1Result> {
    const r = this.db.prepare(this.sql).run(...(this.params as any[]));
    return { meta: { changes: Number(r.changes) } };
  }
}
export function createFakeD1(): D1Like & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  return {
    raw,
    prepare: (sql) => new Stmt(raw, sql),
    // D1.batch() = satu transaksi; gagal satu, batal semua.
    async batch(statements) {
      raw.exec('BEGIN');
      try {
        const out: D1Result[] = [];
        for (const s of statements) out.push(await s.run());
        raw.exec('COMMIT');
        return out;
      } catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
  };
}
