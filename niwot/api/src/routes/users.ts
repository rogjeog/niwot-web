import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const prisma = new PrismaClient();

// Qui suis-je
router.get("/me", requireAuth, async (req, res) => {
  const id = (req as any).userId as number;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, username: true, role: true, wins: true, profileImage: true, createdAt: true },
  });
  res.json({ user });
});

// Leaderboard Top 10 (wins DESC, createdAt ASC)
router.get("/leaderboard", async (_req, res) => {
  const top = await prisma.user.findMany({
    orderBy: [{ wins: "desc" }, { createdAt: "asc" }],
    take: 10,
    select: { id: true, username: true, wins: true, profileImage: true },
  });
  res.json({ top });
});

export default router;
