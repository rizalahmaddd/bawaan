import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { createRouter } from "./app";
import { schema } from "./db";
import { body } from "./lib/http";

export const pushRoutes = createRouter();

/**
 * The service worker calls this after an empty push to learn what to show. iOS requires every push
 * to display a notification, so there's always a fallback message.
 */
pushRoutes.post("/inbox", async (c) => {
  const { endpoint } = await body(c, z.object({ endpoint: z.url() }));
  const db = c.var.db;
  const sub = await db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, endpoint)).get();
  const fallback = { title: "Bawaan", body: "Ada kabar baru untuk pesananmu.", url: "/" };
  if (!sub) return c.json(fallback);
  const note = await db
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.audience, sub.audience),
        eq(schema.notifications.targetId, sub.targetId),
        isNull(schema.notifications.seenAt),
        gt(schema.notifications.createdAt, Date.now() - 3 * 86_400_000),
      ),
    )
    .orderBy(desc(schema.notifications.createdAt))
    .get();
  if (!note) return c.json(fallback);
  await db.update(schema.notifications).set({ seenAt: Date.now() }).where(eq(schema.notifications.id, note.id));
  return c.json({ title: note.title, body: note.body, url: note.url });
});
