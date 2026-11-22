#!/usr/bin/env node
// One-shot rename: resource_feedback -> resource_comments.
//
// The public side is now called "Comments" everywhere (the file-level note
// under the star rating), so the table follows the word students see. The
// shape is unchanged — id / file_id / voter_id / created_at — only the table
// name and the free-text column (`feedback` -> `body`, since `comment` is a
// reserved word in Postgres) move.
//
// Rolling deploy safe: after the rename a read/write *view* named
// resource_feedback is recreated over the new table, so the build that is
// still live (and any tab someone left open) keeps working until the new
// code replaces it. Drop the view once the deploy is verified:
//
//   node scripts/db/rename-feedback-to-comments.mjs --drop-compat
//
// Usage:
//   node --env-file=.env scripts/db/rename-feedback-to-comments.mjs [--dry]
//   node --env-file=.env scripts/db/rename-feedback-to-comments.mjs --drop-compat

import { neon } from "@neondatabase/serverless";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const dropCompat = args.includes("--drop-compat");

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(databaseUrl);

/** pg_class lookup for a table/view name in the public schema. */
async function relationKind(name) {
  const rows = await sql.query(
    `SELECT c.relkind FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = $1`,
    [name]
  );
  return rows[0]?.relkind ?? null; // 'r' table, 'v' view, null absent
}

async function main() {
  if (dropCompat) {
    if ((await relationKind("resource_feedback")) === "v") {
      console.log(dry ? "[dry] would drop view resource_feedback" : "dropping view resource_feedback");
      if (!dry) await sql.query("DROP VIEW resource_feedback");
    } else {
      console.log("no compatibility view to drop");
    }
    return;
  }

  const feedbackKind = await relationKind("resource_feedback");
  const commentsKind = await relationKind("resource_comments");
  console.log({ feedbackKind, commentsKind });

  if (commentsKind === "r" && feedbackKind !== "r") {
    console.log("nothing to do — resource_comments already exists");
    return;
  }
  if (feedbackKind !== "r") {
    throw new Error("resource_feedback is missing; expected a table to rename");
  }

  const steps = [
    // Safety copy: this table only ever held a handful of rows, and a table
    // that is cheap to copy is a migration that is cheap to undo.
    `CREATE TABLE IF NOT EXISTS resource_feedback_legacy AS SELECT * FROM resource_feedback`,
    `ALTER TABLE resource_feedback RENAME TO resource_comments`,
    `ALTER TABLE resource_comments RENAME COLUMN feedback TO body`,
    `CREATE INDEX IF NOT EXISTS resource_comments_file_created_idx
       ON resource_comments (file_id, created_at DESC)`,
    // Backwards-compatible name for the build that is still live.
    `CREATE OR REPLACE VIEW resource_feedback AS
       SELECT id, file_id, voter_id, body AS feedback, created_at FROM resource_comments`,
  ];

  for (const statement of steps) {
    console.log(dry ? `[dry] ${statement.split("\n")[0]}` : statement.split("\n")[0]);
    if (!dry) await sql.query(statement);
  }

  if (dry) {
    console.log("[dry] would rename the primary-key constraint");
    return;
  }

  // The primary-key constraint kept the old name; align it so an error message
  // about a duplicate id does not mention a table that no longer exists.
  const pk = await sql.query(
    `SELECT conname FROM pg_constraint
     WHERE conrelid = 'resource_comments'::regclass AND contype = 'p'`
  );
  const pkName = pk[0]?.conname;
  if (pkName && pkName !== "resource_comments_pkey") {
    console.log(`renaming constraint ${pkName} -> resource_comments_pkey`);
    if (!dry) {
      await sql.query(
        `ALTER TABLE resource_comments RENAME CONSTRAINT "${pkName}" TO resource_comments_pkey`
      );
    }
  }

  const counts = await sql.query(
    `SELECT (SELECT count(*) FROM resource_comments)::int AS comments,
            (SELECT count(*) FROM resource_feedback_legacy)::int AS legacy`
  );
  console.log(counts[0]);
}

main().catch((error) => {
  console.error("migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
