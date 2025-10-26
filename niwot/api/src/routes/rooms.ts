import { Router } from "express";
import { snapshotPublicRooms } from "../sockets/index.js";
import { PrismaClient } from "@prisma/client";
import { requireAuth } from "../middleware/auth.js";

type Visibility = "public" | "private";
type PointMode = "degressive" | "fixed";

const prisma = new PrismaClient();
const router = Router();

function code6(): string {
  const CH = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: 6 }, () => CH[Math.floor(Math.random() * CH.length)]).join("");
}
async function genCodeUnique(): Promise<string> {
  while (true) {
    const c = code6();
    const exists = await prisma.room.findUnique({ where: { code: c } });
    if (!exists) return c;
  }
}
async function me(userId: number) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, profileImage: true },
  });
}
function serialize(room: any, requesterId: number) {
  return {
    code: room.code,
    name: room.name,
    hostId: room.hostId,
    youAreHost: room.hostId === requesterId,
    members: (room.members || []).map((m: any) => ({
      userId: m.userId,
      username: m.user?.username ?? "",
      profileImage: m.user?.profileImage ?? null,
      ready: m.ready,
      isHost: m.isHost,
    })),
    settings: {
      visibility: room.visibility,
      maxPlayers: room.maxPlayers,
      excludedUsernames: room.excludedUsernames || [],
      categories: room.categories || [],
      answerTimeSec: room.answerTimeSec,
      targetPoints: room.targetPoints,
      pointMode: room.pointMode,
      showProposals: room.showProposals,
    },
  };
}

// POST /rooms -> crée la salle + ajoute l'hôte en members (création imbriquée SANS roomCode)
router.post("/rooms", requireAuth, async (req, res) => {
  const userId = (req as any).userId as number;
  const u = await me(userId);
  if (!u) return res.status(401).json({ error: "Non authentifié" });

  const code = await genCodeUnique();
  const name = (req.body?.name && String(req.body.name).trim().slice(0, 80)) || `Salle de ${u.username}`;
  const visibility: Visibility = req.body?.visibility === "private" ? "private" : "public";

  const room = await prisma.room.create({
    data: {
      code,
      name,
      hostId: u.id,
      visibility,
      maxPlayers: 10,
      excludedUsernames: [],
      categories: [],
      answerTimeSec: 15,
      targetPoints: 100,
      pointMode: "degressive",
      showProposals: true,
      members: {
        create: [
          // ⚠️ Pas de roomCode ici : Prisma le déduit car on crée via la relation Room.members
          { userId: u.id, isHost: true, ready: false },
        ],
      },
    },
    include: { members: { include: { user: true } } },
  });

  console.log(`[rooms] created ${code} by #${u.id} (${u.username}) [DB]`);
  return res.status(201).json({ room: serialize(room, userId) });
});

// POST /rooms/:code/join -> rejoint si existe
router.post("/rooms/:code/join", requireAuth, async (req, res) => {
  const userId = (req as any).userId as number;
  const u = await me(userId);
  if (!u) return res.status(401).json({ error: "Non authentifié" });

  const code = String(req.params.code || "").toUpperCase();
  let room = await prisma.room.findUnique({
    where: { code },
    include: { members: { include: { user: true } } },
  });
  if (!room) return res.status(404).json({ error: "Salle introuvable" });

  const excluded = (room.excludedUsernames as string[] | null) || [];
  if (excluded.map((x) => x.toLowerCase()).includes(u.username.toLowerCase())) {
    return res.status(403).json({ error: "Vous êtes exclu de cette salle" });
  }

  const already = room.members.find((m: any) => m.userId === u.id);
  if (!already) {
    if (room.members.length >= room.maxPlayers) {
      return res.status(409).json({ error: "Salle pleine" });
    }
    // Ici on est HORS création imbriquée -> on DOIT fournir roomCode
    await prisma.roomMember.create({ data: { roomCode: code, userId: u.id, isHost: false, ready: false } });
  }

  room = await prisma.room.findUnique({
    where: { code },
    include: { members: { include: { user: true } } },
  });
  console.log(`[rooms] join ${code} by #${u.id} (${u.username}) [DB]`);
  return res.json({ room: serialize(room, userId) });
});

// GET /rooms/:code -> détails
// --- Liste des salles publiques (placée avant /rooms/:code pour éviter le conflit)
router.get("/rooms/public", (_req, res) => {
  try {
    const rooms = snapshotPublicRooms();
    res.json({ rooms });
  } catch (e:any) {
    console.error("[rooms] /rooms/public error", e?.message || e);
    res.status(500).json({ error: "failed_to_list_public_rooms" });
  }
});

router.get("/rooms/:code", requireAuth, async (req, res) => {
  const userId = (req as any).userId as number;
  const code = String(req.params.code || "").toUpperCase();
  const room = await prisma.room.findUnique({
    where: { code },
    include: { members: { include: { user: true } } },
  });
  if (!room) {
    console.warn(`[rooms] get ${code}: NOT FOUND [DB]`);
    return res.status(404).json({ error: "Salle introuvable" });
  }
  console.log(`[rooms] get ${code}: OK [DB]`);
  return res.json({ room: serialize(room, userId) });
});

// PATCH /rooms/:code -> MAJ paramètres (hôte uniquement)
router.patch("/rooms/:code", requireAuth, async (req, res) => {
  const userId = (req as any).userId as number;
  const code = String(req.params.code || "").toUpperCase();
  const room = await prisma.room.findUnique({ where: { code } });
  if (!room) return res.status(404).json({ error: "Salle introuvable" });
  if (room.hostId !== userId) return res.status(403).json({ error: "Réservé à l'hôte" });

  const data: any = {};
  if (req.body?.name) data.name = String(req.body.name).trim().slice(0, 80);
  if (req.body?.visibility) data.visibility = req.body.visibility === "private" ? "private" : "public";
  if (req.body?.maxPlayers != null) { const v = Number(req.body.maxPlayers); if (Number.isFinite(v) && v>=2 && v<=16) data.maxPlayers = v|0; }
  if (Array.isArray(req.body?.excludedUsernames)) data.excludedUsernames = req.body.excludedUsernames.map((x: string) => String(x));
  if (Array.isArray(req.body?.categories)) data.categories = req.body.categories.map((x: any) => Number(x)).filter(Number.isFinite);
  if (req.body?.answerTimeSec != null) { const t = Number(req.body.answerTimeSec); if (Number.isFinite(t) && t>=5 && t<=60) data.answerTimeSec = t|0; }
  if (req.body?.targetPoints != null) { const p = Number(req.body.targetPoints); if (Number.isFinite(p) && p>=50 && p<=500) data.targetPoints = p|0; }
  if (req.body?.pointMode) data.pointMode = (req.body.pointMode === "fixed" ? "fixed" : "degressive") as PointMode;
  if (req.body?.showProposals != null) data.showProposals = !!req.body.showProposals;

  await prisma.room.update({ where: { code }, data });
  const updated = await prisma.room.findUnique({ where: { code }, include: { members: { include: { user: true } } } });
  return res.json({ room: serialize(updated, userId) });
});

export default router;
