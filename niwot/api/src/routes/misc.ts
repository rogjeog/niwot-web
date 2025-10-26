import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

// Exemple: leaderboard (TOP 10)
router.get("/leaderboard", async (_req, res) => {
  const leaders = await prisma.user.findMany({
    orderBy: [{ wins: "desc" }, { id: "asc" }],
    take: 10,
    select: { username: true, wins: true },
  });
  res.json({ leaders });
});

// Ajoute ici d'autres endpoints "divers" mais surtout PAS de /rooms*

// --- Top 10 contributeurs (questions "approved") ---
router.get("/leaderboard/proposers", async (_req, res) => {
  try {
    type Row = { createdById: number | null; approvedCount: bigint | number };
    const rows: Row[] = await (prisma as any).$queryRawUnsafe(
      "SELECT createdById, COUNT(*) AS approvedCount FROM `Question` WHERE status = 'approved' AND createdById IS NOT NULL GROUP BY createdById ORDER BY approvedCount DESC LIMIT 50"
    );

    const idCounts = (rows || [])
      .filter(r => r.createdById !== null)
      .map(r => ({ id: Number(r.createdById), count: Number(r.approvedCount) }));

    if (idCounts.length === 0) return res.json({ proposers: [] });

    const ids = idCounts.map(x => x.id);
    const users = await (prisma as any).user.findMany({
      where: { id: { in: ids } },
      select: { id: true, username: true, profileImage: true },
    });

    const map = new Map(users.map((u:any) => [Number(u.id), u]));

    const proposers = idCounts
      .filter(x => map.has(x.id))
      .sort((a, b) => b.count - a.count || a.id - b.id)
      .slice(0, 10)
      .map(x => {
        const u:any = map.get(x.id);
        return { id: x.id, username: u.username, profileImage: u.profileImage, approvedCount: x.count };
      });

    res.json({ proposers });
  } catch (e:any) {
    console.error("[misc] /leaderboard/proposers error", e?.message || e);
    res.status(500).json({ error: "failed_to_fetch_proposers" });
  }
});


export default router;
