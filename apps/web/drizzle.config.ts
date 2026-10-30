import { defineConfig } from "drizzle-kit";

// drizzle-kit only generates SQL and keeps its snapshots here; copy new files into /migrations, wrangler applies those.
export default defineConfig({
  dialect: "sqlite",
  schema: "./worker/db/schema.ts",
  out: "./drizzle",
});
