import type { Express, Request, Response } from "express";
import { PrismaClient, QuestionStatus } from "@prisma/client";
import { requireAuth } from "../middleware/auth.js";
import multer from "multer";
import path from "path";
import fs from "fs";
import { normalizeAnswer } from "../utils/normalize.js";

const prisma = new PrismaClient();

const uploadDir = process.env.UPLOAD_DIR || "/app/uploads";
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random()*1e9);
    cb(null, 'question-' + unique + path.extname(file.originalname).toLowerCase());
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) return cb(new Error('Format image invalide'));
    cb(null, true);
  }
});

export function registerQuestionRoutes(app: Express) {
  app.get("/categories", async (_req: Request, res: Response) => {
    const categories = await prisma.category.findMany({ orderBy: { name: 'asc' } });
    res.json({ categories });
  });

  app.post("/suggest", requireAuth, upload.single('image'), async (req: Request, res: Response) => {
    try {
      const user = (req as any).user as { id: number; role: 'user' | 'admin' };
      const { text, type, citationText, answer, alternatives, explanation, categoryIds } = req.body as any;
      if (!text || !type || !answer || !explanation || !categoryIds) return res.status(400).json({ error: "Champs manquants" });
      if (!['CITATION','IMAGE'].includes(type)) return res.status(400).json({ error: "Type invalide" });
      const normalizedAnswer = normalizeAnswer(answer);
      const normalizedAlternatives = (alternatives ? JSON.parse(alternatives) : [])
        .map((s:string) => normalizeAnswer(s))
        .filter((s:string) => !!s && s !== normalizedAnswer);
      const status: QuestionStatus = user.role === 'admin' ? 'approved' : 'awaiting_approval';
      const imagePath = req.file ? `/uploads/${req.file.filename}` : undefined;
      const created = await prisma.question.create({
        data: {
          text,
          type,
          citationText: type === 'CITATION' ? (citationText || '') : null,
          imagePath: type === 'IMAGE' ? (imagePath || null) : null,
          answer: normalizedAnswer,
          alternatives: normalizedAlternatives,
          explanation,
          status,
          createdById: user.id,
          categories: {
            connect: (Array.isArray(categoryIds) ? categoryIds : JSON.parse(categoryIds)).map((id:number)=>({ id:Number(id) }))
          }
        },
        include: { categories: true, createdBy: { select: { id: true, username: true } } }
      });
      res.json({ ok: true, question: created });
    } catch (e:any) {
      res.status(500).json({ error: e.message || "Erreur serveur" });
    }
  });

  app.get("/questions", async (req: Request, res: Response) => {
    const { status, categories } = req.query as any;
    const where:any = {};
    if (status) where.status = status;
    if (categories) {
      const ids = String(categories).split(',').map(s=>Number(s)).filter(Boolean);
      if (ids.length) where.categories = { some: { id: { in: ids } } };
    }
    const list = await prisma.question.findMany({
      where, include: { categories: true, createdBy: { select: { id: true, username: true } } },
      orderBy: { createdAt: 'desc' }, take: 50
    });
    res.json({ list });
  });
}


