import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

/** GET /categories -> liste simple */
router.get("/categories", async (_req, res) => {
  try {
    const cats = await prisma.category.findMany({
      orderBy: { name: "asc" } as any,
      select: { id: true, name: true } as any,
    } as any);
    return res.json({ categories: cats });
  } catch (e:any) {
    console.error("[categories] error", e?.message || e);
    return res.status(500).json({ error: "failed_to_list_categories" });
  }
});

/** GET /categories/stats -> { id, name, approvedCount } via SQL brut (MySQL) */
router.get("/categories/stats", async (_req, res) => {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT c.id, c.name, COALESCE(COUNT(DISTINCT q.id), 0) AS approvedCount
      FROM Category c
      LEFT JOIN _CategoryToQuestion ct ON ct.A = c.id
      LEFT JOIN Question q ON q.id = ct.B AND q.status = 'approved'
      GROUP BY c.id
      ORDER BY c.name ASC
    `);
    const categories = rows.map(r => ({
      id: Number(r.id),
      name: String(r.name),
      approvedCount: Number(r.approvedCount || 0),
    }));
    return res.json({ categories });
  } catch (e:any) {
    console.error("[categories:stats] error", e?.message || e);
    return res.status(500).json({ error: "failed_to_list_category_stats" });
  }
});

export default router;
