import { Pool, type QueryResult, type QueryResultRow } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
let pool: Pool | null = null;

function getPool(): Pool {
  if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL in environment variables.');
  }

  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
    });
  }

  return pool;
}

export type QueryParam =
  | string
  | number
  | boolean
  | Date
  | null
  | string[]
  | number[]
  | boolean[];

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: QueryParam[]
): Promise<QueryResult<T>> {
  const pgPool = getPool();
  return pgPool.query<T>(text, params);
}

/**
 * Run multiple queries in a single DB transaction.
 */
export async function withTransaction<T>(
  fn: (txQuery: typeof query) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  const txQuery = async <R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: QueryParam[]
  ): Promise<QueryResult<R>> => client.query<R>(text, params);

  try {
    await client.query('BEGIN');
    const result = await fn(txQuery);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback errors; original error is more useful.
    }
    throw error;
  } finally {
    client.release();
  }
}
