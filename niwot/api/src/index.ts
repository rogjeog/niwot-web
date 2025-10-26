import express from "express";
import { PrismaClient } from "@prisma/client";
import leaderboardRouter from "./routes/leaderboard";

import { createRequire } from "module";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import { initSockets } from "./sockets/index.js";

const app = express();

const PORT = Number(process.env.PORT || 4000);
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || "https://niwot.btsinfo.nc";
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || ".btsinfo.nc";

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

const corsConfig = {
  origin: PUBLIC_ORIGIN,
  credentials: true,
  methods: ["GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization","X-Requested-With"],
};
app.use(cors(corsConfig));
app.options("*", cors(corsConfig));

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// TRACE global pour tout /rooms*
app.all(/^\/rooms(\/.*)?$/i, (req, _res, next) => {
  console.log(`[rooms][INDEX] ${req.method} ${req.originalUrl}`);
  next();
});

// Fichiers statiques d'uploads
app.use("/uploads", express.static("/app/uploads", { maxAge: "7d", immutable: true }));

// Helpers de montage
function isRouter(x: any): boolean {
  return !!x && typeof x === "function" && typeof x.use === "function";
}
function safeCall(fn: any, ...args: any[]) {
  try { return fn?.(...args); } catch { return null; }
}
function resolveRouter(mod: any) {
  const seen = new Set<any>();
  const q: any[] = [mod, mod?.default, mod?.router, ...(Object.values(mod||{}))];
  while (q.length) {
    const cand = q.shift();
    if (!cand || seen.has(cand)) continue;
    seen.add(cand);
    if (isRouter(cand)) return cand;
    if (typeof cand === "function") {
      const out = safeCall(cand);
      if (isRouter(out)) return out;
      if (out && typeof out === "object") {
        q.push(out, out?.default, out?.router, ...(Object.values(out)));
      }
    }
    if (cand && typeof cand === "object") {
      q.push(cand?.default, cand?.router, ...(Object.values(cand)));
    }
  }
  return null;
}
function mountModule(app: any, mod: any, name: string, prefix: string) {
  const r = resolveRouter(mod);
  if (r) {
    app.use(prefix, r);
    console.log(`[api] mounted ${name} as Router on ${prefix}`);
    return;
  }
  let mounted = false;
  for (const [k,v] of Object.entries(mod||{})) {
    if (typeof v === "function") {
      const args = v.length >= 2 ? [app, prefix] : [app];
      const out = safeCall(v, ...args);
      if (isRouter(out)) {
        app.use(prefix, out);
        mounted = true;
        console.log(`[api] mounted ${name}.${k} -> Router on ${prefix}`);
      } else {
        mounted = true;
        console.log(`[api] invoked ${name}.${k} on ${prefix}`);
      }
    }
  }
  if (!mounted) console.error(`[api] ${name}: aucun Router ni fonction de registre — rien monté sur ${prefix}`);
}

// Health
app.get("/health", (_req, res) => res.json({ ok: true }));

// Debug : lister les routes montées
app.get("/__debug/routes", (_req, res) => {
  const list: any[] = [];
  // @ts-ignore
  (app._router.stack || []).forEach((l: any) => {
    if (l?.route?.path) {
      const methods = Object.keys(l.route.methods || {}).filter(Boolean).join(",");
      list.push({ path: l.route.path, methods });
    } else if (l?.name === "router" && l?.handle?.stack) {
      l.handle.stack.forEach((h: any) => {
        const methods = Object.keys(h.route?.methods || {}).filter(Boolean).join(",");
        if (h.route?.path) list.push({ path: h.route.path, methods });
      });
    }
  });
  res.json({ routes: list });
});

async function start() {
  const authMod       = await import("./routes/auth.js");
  const roomsMod      = await import("./routes/rooms.js");       // <— MONTER EN PREMIER
  const usersMod      = await import("./routes/users.js");
  const miscMod       = await import("./routes/misc.js");        // <— APRÈS rooms
  const questionsMod  = await import("./routes/questions.js");
  const adminMod      = await import("./routes/admin.js");
  const categoriesMod = await import("./routes/categories.js");

  mountModule(app, authMod,       "auth",       "/auth");
  mountModule(app, roomsMod,      "rooms",      "/");            // /rooms, /rooms/:code, etc.
  mountModule(app, usersMod,      "users",      "/");
  mountModule(app, miscMod,       "misc",       "/");
  mountModule(app, questionsMod,  "questions",  "/");
  mountModule(app, adminMod,      "admin",      "/admin");
  mountModule(app, categoriesMod, "categories", "/");

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: PUBLIC_ORIGIN, credentials: true } });
  initSockets(io);

  server.listen(PORT, () => {
    console.log(`[api] listening on :${PORT} (origin ${PUBLIC_ORIGIN}, cookie domain ${COOKIE_DOMAIN})`);
  });
}

start().catch((e) => { console.error("[api] start() failed:", e); process.exit(1); });

console.log("[api] mounted leaderboard as Router on /");

