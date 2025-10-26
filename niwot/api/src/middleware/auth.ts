import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

type Role = "user" | "admin";
type JwtPayload = { id: number; role: Role };

const JWT_SECRET = process.env.JWT_SECRET || "niwot_dev_secret_change_me";

function extractToken(req: Request): string | null {
  const c: any = (req as any).cookies || {};
  if (typeof c.token === "string" && c.token) return c.token;
  if (typeof c.niwot_token === "string" && c.niwot_token) return c.niwot_token;
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

function stampUser(req: Request, payload: JwtPayload) {
  (req as any).userId = payload.id;
  (req as any).role = payload.role;
  (req as any).user = { id: payload.id, role: payload.role };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: "Non authentifié" });
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    stampUser(req, payload);
    next();
  } catch {
    return res.status(401).json({ error: "Non authentifié" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: "Non authentifié" });
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    if (payload.role !== "admin") return res.status(403).json({ error: "Interdit" });
    stampUser(req, payload);
    next();
  } catch {
    return res.status(401).json({ error: "Non authentifié" });
  }
}
