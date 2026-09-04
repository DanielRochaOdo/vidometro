import { Pool, type QueryResultRow } from "pg";

const globalForPg = globalThis as typeof globalThis & { vidometroPool?: Pool };

function getPool() {
  if (!globalForPg.vidometroPool) {
    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) throw new Error("DATABASE_URL não configurada.");

    globalForPg.vidometroPool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: process.env.DATABASE_SSL?.toLowerCase() === "true"
        ? { rejectUnauthorized: false }
        : false
    });
  }
  return globalForPg.vidometroPool;
}

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = []
) {
  return getPool().query<T>(text, [...values]);
}

export async function closeDb() {
  if (!globalForPg.vidometroPool) return;
  await globalForPg.vidometroPool.end();
  globalForPg.vidometroPool = undefined;
}
