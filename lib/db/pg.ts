import { Pool, type PoolConfig, type QueryResultRow } from 'pg';

function getRequiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} environment variable`);
  return v;
}

function shouldUseSsl(connectionString: string): boolean {
  try {
    const u = new URL(connectionString);
    const host = (u.hostname || '').toLowerCase();
    // Local dev typically has no SSL
    if (host === 'localhost' || host === '127.0.0.1') return false;
    return true;
  } catch {
    // If it's not a valid URL, default to SSL for safety on hosted providers.
    return true;
  }
}

function buildPoolConfig(): PoolConfig {
  const connectionString = getRequiredEnv('DATABASE_URL');

  return {
    connectionString,
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : false,
    // Avoid hanging requests forever if the DB is unreachable.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    max: 10,
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __findrePgPool: Pool | undefined;
}

export const pool: Pool = global.__findrePgPool ?? new Pool(buildPoolConfig());

if (process.env.NODE_ENV !== 'production') {
  global.__findrePgPool = pool;
}

export function isPgUniqueViolation(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: unknown }).code === '23505'
  );
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await pool.query<T>(text, params);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}


