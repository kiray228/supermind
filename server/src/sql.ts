/** Postgres через Neon SQL-over-HTTP: без драйверов и пулов, один запрос — один HTTP-вызов. */

export type Row = (string | null)[];

export interface Sql {
  query(query: string, params?: unknown[]): Promise<Row[]>;
}

export class NeonHttpSql implements Sql {
  private connectionString: string;
  private endpoint: string;
  private fetchImpl: typeof fetch;

  constructor(connectionString: string, fetchImpl: typeof fetch = fetch) {
    this.connectionString = connectionString;
    const host = new URL(connectionString).hostname;
    this.endpoint = `https://${host.replace(/^[^.]+\./, 'api.')}/sql`;
    this.fetchImpl = fetchImpl;
  }

  async query(query: string, params: unknown[] = []): Promise<Row[]> {
    const res = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        'Neon-Connection-String': this.connectionString,
        'Neon-Raw-Text-Output': 'true',
        'Neon-Array-Mode': 'true',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, params }),
    });
    const data = (await res.json().catch(() => ({}))) as { rows?: Row[]; message?: string; code?: string };
    if (!res.ok) {
      const error = new Error(`Postgres ${res.status}: ${data.message ?? 'ошибка'}`) as Error & { code?: string };
      error.code = data.code;
      throw error;
    }
    return data.rows ?? [];
  }
}

/** Схема создаётся при первом запросе — по одному оператору (SQL-over-HTTP не принимает пачку). */
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    name text NOT NULL DEFAULT '',
    pass_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz NOT NULL DEFAULT now(),
    agent text NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS auth_failures (
    email text NOT NULL,
    at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS auth_failures_email ON auth_failures (email, at)`,
  `CREATE SEQUENCE IF NOT EXISTS kv_seq`,
  `CREATE TABLE IF NOT EXISTS kv (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key text NOT NULL,
    value jsonb,
    updated_at bigint NOT NULL,
    deleted boolean NOT NULL DEFAULT false,
    seq bigint NOT NULL,
    PRIMARY KEY (user_id, key)
  )`,
  `CREATE INDEX IF NOT EXISTS kv_user_seq ON kv (user_id, seq)`,
  `CREATE TABLE IF NOT EXISTS devices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    secret_hash text NOT NULL,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    endpoint text NOT NULL UNIQUE,
    p256dh text NOT NULL,
    auth text NOT NULL,
    platform text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS push_queue (
    device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    item_id text NOT NULL,
    fire_at timestamptz NOT NULL,
    payload jsonb NOT NULL,
    sent_at timestamptz,
    PRIMARY KEY (device_id, item_id)
  )`,
  `CREATE INDEX IF NOT EXISTS push_queue_due ON push_queue (fire_at) WHERE sent_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS snapshots (
    id bigserial PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    reason text NOT NULL DEFAULT 'auto',
    keys integer NOT NULL DEFAULT 0,
    bytes integer NOT NULL DEFAULT 0,
    data jsonb NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS snapshots_user ON snapshots (user_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS meta (
    key text PRIMARY KEY,
    value jsonb NOT NULL
  )`,
];

export async function ensureSchema(sql: Sql) {
  for (const statement of SCHEMA) await sql.query(statement);
}
