import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

/**
 * GET /leaderboard
 * Top 10 joueurs par wins (desc), tie-break createdAt puis id.
 * (Admins inclus)
 * Réponse: { leaders: [{ id, username, profileImage, wins }] }
 */
router.get("/leaderboard", async (_req, res) => {
  try {
    const leaders = await prisma.user.findMany({
      select: { id: true, username: true, profileImage: true, wins: true, createdAt: true },
      orderBy: [{ wins: "asc" as const }], // NOTE: on renvoie ensuite trié desc côté map si besoin
      take: 100
    } as any);

    // tri desc sûr (au cas où)
    leaders.sort((a:any,b:any)=> (b.wins??0) - (a.wins??0) || +new Date(a.createdAt) - +new Date(b.createdAt) || a.id - b.id);

    return res.json({ leaders: leaders.slice(0,10) });
  } catch (e: any) {
    console.error("[leaderboard] error", e?.message || e);
    return res.status(500).json({ error: "failed_to_fetch_leaderboard" });
  }
});

/**
 * GET /leaderboard/proposers
 * Top 10 des utilisateurs avec le PLUS de questions APPROUVÉES.
 * (Admins inclus)
 * Réponse: { proposers: [{ id, username, profileImage, approvedCount }] }
 */
router.get("/leaderboard/proposers", async (_req, res) => {
  try {
    type Row = { createdById: number | null; approvedCount: bigint | number };
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      "SELECT createdById, COUNT(*) AS approvedCount FROM `Question` WHERE status = 'approved' AND createdById IS NOT NULL GROUP BY createdById ORDER BY approvedCount DESC LIMIT 50"
    );

    const idCounts = (rows || [])
      .filter(r => r.createdById !== null)
      .map(r => ({ id: Number(r.createdById), count: Number(r.approvedCount) }));

    if (idCounts.length === 0) return res.json({ proposers: [] });

    const ids = idCounts.map(x => x.id);
    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, username: true, profileImage: true },
    } as any);

    const usersById = new Map(users.map(u => [Number(u.id), u]));

    const proposers = idCounts
      .filter(x => usersById.has(x.id))
      .sort((a, b) => b.count - a.count || a.id - b.id)
      .slice(0, 10)
      .map(x => {
        const u = usersById.get(x.id)!;
        return { id: x.id, username: u.username, profileImage: u.profileImage, approvedCount: x.count };
      });

    return res.json({ proposers });
  } catch (e: any) {
    console.error("[leaderboard/proposers] error", e?.message || e);
    return res.status(500).json({ error: "failed_to_fetch_proposers" });
  }
});

export default router;
