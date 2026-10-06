/** Postgres в памяти (PGlite) с тем же интерфейсом, что Neon SQL-over-HTTP: строки — массивы текстовых значений */
import { PGlite } from '@electric-sql/pglite';
import type { Row, Sql } from '../src/sql.ts';

export class PgliteSql implements Sql {
  db = new PGlite();

  async query(query: string, params: unknown[] = []): Promise<Row[]> {
    try {
      const r = await this.db.query<Record<string, unknown>>(query, params, { rowMode: 'array' } as never);
      return (r.rows as unknown as unknown[][]).map((row) =>
        row.map((v) => (v == null ? null : typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v instanceof Date ? v.toISOString() : typeof v === 'boolean' ? (v ? 't' : 'f') : String(v))),
      );
    } catch (e) {
      const err = e as Error & { code?: string };
      throw Object.assign(new Error(err.message), { code: err.code });
    }
  }
}
