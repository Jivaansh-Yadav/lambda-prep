// Creates the outbound_clicks table (see src/lib/outbound-server.ts). There is
// no migration runner in this project — this script is the migration, run once
// against the production database:
//
//   bun scripts/create-outbound-clicks.mjs
//
// Idempotent: `IF NOT EXISTS` everywhere, so a second run is a no-op.
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(databaseUrl);

await sql.query(`
  CREATE TABLE IF NOT EXISTS outbound_clicks (
    id BIGSERIAL PRIMARY KEY,
    destination TEXT NOT NULL,
    entry TEXT NOT NULL,
    board TEXT,
    class_slug TEXT,
    subject TEXT,
    path TEXT,
    country TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`);
await sql.query(`CREATE INDEX IF NOT EXISTS outbound_clicks_created_at_idx ON outbound_clicks (created_at DESC)`);
await sql.query(
  `CREATE INDEX IF NOT EXISTS outbound_clicks_destination_idx ON outbound_clicks (destination, entry, created_at DESC)`,
);

console.log("outbound_clicks is ready");
