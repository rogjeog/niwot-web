import { Router } from "express";
import { PrismaClient, Prisma } from "@prisma/client";
import { requireAdmin } from "../middleware/auth.js";

const prisma = new PrismaClient();
const router = Router();

// Toute l'admin nécessite le rôle admin
router.use(requireAdmin);

// ----------------------
// UTILISATEURS
// ----------------------
router.get("/users", async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { id: "asc" },
    select: { id: true, username: true, role: true, wins: true, profileImage: true, createdAt: true },
  });
  res.json({ users });
});

// ----------------------
// QUESTIONS
// ----------------------
router.get("/questions", async (_req, res) => {
  const questions = await prisma.question.findMany({
    orderBy: { id: "asc" },
    include: {
      createdBy: { select: { username: true } },
      categories: true
    },
  });
  res.json({ questions });
});

router.patch("/questions/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body as { status: "awaiting_approval" | "approved" | "refused" };
  if (!["awaiting_approval","approved","refused"].includes(String(status))) {
    return res.status(400).json({ error: "Statut invalide" });
  }
  await prisma.question.update({ where: { id }, data: { status } });
  res.json({ ok: true });
});

router.delete("/questions/:id", async (req, res) => {
  const id = Number(req.params.id);
  await prisma.question.delete({ where: { id } });
  res.json({ ok: true });
});

// ----------------------
// CATEGORIES (NOUVEAU)
// ----------------------

// util: fabriquer un slug simple et unique-ish
function slugify(name: string) {
  return name
    .normalize("NFD").replace(/\p{Diacritic}+/gu, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 60);
}

router.get("/categories", async (_req, res) => {
  const cats = await prisma.category.findMany({
    orderBy: { id: "asc" },
    include: { _count: { select: { questions: true } } }
  });
  const categories = cats.map(c => ({
    id: c.id,
    name: c.name,
    slug: (c as any).slug ?? c.name, // au cas où slug n'existe pas dans ton modèle
    questionCount: c._count.questions,
    createdAt: (c as any).createdAt ?? null
  }));
  res.json({ categories });
});

router.post("/categories", async (req, res) => {
  const { name } = req.body as { name: string };
  if (!name || !name.trim()) return res.status(400).json({ error: "Nom requis" });
  const slug = slugify(name);

  try {
    const created = await prisma.category.create({
      data: {
        name: name.trim(),
        // si tu as un champ slug unique dans ton modèle, dé-commente :
        // slug,
      }
    });
    res.json({ category: { ...created, slug } });
  } catch (e: any) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return res.status(409).json({ error: "Catégorie déjà existante" });
    }
    throw e;
  }
});

router.put("/categories/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body as { name: string };
  if (!name || !name.trim()) return res.status(400).json({ error: "Nom requis" });
  const slug = slugify(name);

  try {
    const updated = await prisma.category.update({
      where: { id },
      data: {
        name: name.trim(),
        // slug,
      }
    });
    res.json({ category: { ...updated, slug } });
  } catch (e: any) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return res.status(409).json({ error: "Catégorie déjà existante" });
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return res.status(404).json({ error: "Catégorie introuvable" });
    }
    throw e;
  }
});

router.delete("/categories/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    await prisma.category.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e: any) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return res.status(404).json({ error: "Catégorie introuvable" });
    }
    throw e;
  }
});

export default router;
