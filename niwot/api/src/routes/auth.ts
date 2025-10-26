import type { Express, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
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
    cb(null, 'avatar-' + unique + path.extname(file.originalname).toLowerCase());
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) return cb(new Error('Format image invalide'));
    cb(null, true);
  }
});

function validatePassword(pw: string): boolean {
  return /[A-Z]/.test(pw) && /[a-z]/.test(pw) && pw.length >= 8;
}

function issue(res: Response, payload: any) {
  const token = jwt.sign(payload, process.env.JWT_SECRET as string, { expiresIn: '7d' });
  const secure = true;
  const sameSite: any = 'lax';
  const domain = process.env.COOKIE_DOMAIN || undefined;
  res.cookie('niwot_token', token, { httpOnly: true, secure, sameSite, domain, maxAge: 7*24*3600*1000 });
  return token;
}

export function registerAuthRoutes(app: Express) {
  app.post("/auth/register", upload.single('avatar'), async (req: Request, res: Response) => {
    try {
      const { username, password, password2 } = req.body;
      if (!username || !password || !password2) return res.status(400).json({ error: "Champs manquants" });
      if (password !== password2) return res.status(400).json({ error: "Les mots de passe ne correspondent pas" });
      if (!validatePassword(password)) return res.status(400).json({ error: "Mot de passe trop faible (8+ car., 1 maj., 1 min.)" });
      const existing = await prisma.user.findUnique({ where: { username } });
      if (existing) return res.status(409).json({ error: "Nom d'utilisateur déjà utilisé" });
      const hash = await bcrypt.hash(password, 12);
      const avatarPath = req.file ? `/uploads/${req.file.filename}` : null;
      const user = await prisma.user.create({
        data: { username, password: hash, role: 'user', profileImage: avatarPath || undefined }
      });
      const token = issue(res, { id: user.id, username: user.username, role: user.role });
      res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role, profileImage: user.profileImage }, token });
    } catch (e:any) {
      res.status(500).json({ error: e.message || "Erreur serveur" });
    }
  });

  app.post("/auth/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ error: "Champs manquants" });
      const user = await prisma.user.findUnique({ where: { username } });
      if (!user) return res.status(401).json({ error: "Identifiants invalides" });
      const ok = await bcrypt.compare(password, user.password);
      if (!ok) return res.status(401).json({ error: "Identifiants invalides" });
      const token = issue(res, { id: user.id, username: user.username, role: user.role });
      res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role, profileImage: user.profileImage }, token });
    } catch (e:any) {
      res.status(500).json({ error: e.message || "Erreur serveur" });
    }
  });

  app.post("/auth/logout", async (_req: Request, res: Response) => {
    res.clearCookie('niwot_token', { httpOnly: true, secure: true, sameSite: 'lax', domain: process.env.COOKIE_DOMAIN || undefined });
    res.json({ ok: true });
  });

  app.get("/me", async (req: Request, res: Response) => {
    try {
      const token = req.cookies['niwot_token'] || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.substring(7) : undefined);
      if (!token) return res.status(200).json({ user: null });
      const payload = jwt.verify(token, process.env.JWT_SECRET as string) as any;
      const user = await prisma.user.findUnique({ where: { id: payload.id }, select: { id: true, username: true, role: true, profileImage: true, wins: true } });
      res.json({ user });
    } catch {
      res.json({ user: null });
    }
  });
}

