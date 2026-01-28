import { Pool, type QueryResult, type QueryResultRow } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
let pool: Pool | null = null;

function getPool(): Pool {
  if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL in environment variables.');
  }

  if (!pool) {
    pool = new Pool({ connectionString: databaseUrl });
  }

  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: Array<string | number | boolean | Date | null>
): Promise<QueryResult<T>> {
  const pgPool = getPool();
  return pgPool.query<T>(text, params);
}
