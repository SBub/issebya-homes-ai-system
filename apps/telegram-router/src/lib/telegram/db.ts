import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

function createPool(connString: string): pg.Pool {
  return new pg.Pool({ connectionString: connString, max: 5 });
}

export const pool = createPool(connectionString);
