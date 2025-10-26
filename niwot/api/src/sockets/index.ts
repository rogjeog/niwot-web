import type { Server, Socket } from "socket.io";
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

const log = (...a: any[]) => console.log("[sockets]", ...a);

function normalizeAnswer(s: string) {
  return (s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
}

type Player = {
  id: string; userId: number; username: string; avatar?: string|null;
  points: number; ready: boolean; answered?: boolean;
};
type RoomParams = {
  private: boolean;
  maxPlayers: number;
  excludedUsernames: string[];
  categories: number[];
  answerTimeSec: number;
  targetPoints: number;
  scoring: 'degressif'|'fixe';
  showProposals: boolean;

  approvedOnly?: boolean;
  preCountdownSec?: number;
  resultDelaySec?: number;
  allowJoinMidQuiz?: boolean;
};
type CurrentQ = {
  id: number; text: string; type: 'CITATION'|'IMAGE'|'TEXT';
  citationText?: string|null; imagePath?: string|null;
  answer: string; alternatives: string[]; explanation?: string|null;
  createdBy?: { id: number; username: string } | null;
  categories?: { id: number; name: string }[];
};
type Room = { name?: string | null;

  code: string; hostId: string; hostUserId: number;
  params: RoomParams; players: Player[]; status: 'lobby'|'running'|'ended';
  currentQuestion?: CurrentQ | null;
  roundStartsAt?: number | null;
  roundEndsAt?: number | null;
  timeout?: ReturnType<typeof setTimeout> | null;
  proposals?: Record<string, string>; firstFinder?: string;
};

const rooms = new Map<string, Room>();
const socketUsers = new Map<string, number>();

const isHostSocket = (socket: Socket, room: Room) => {
  if (room.hostId === socket.id) return true;
  const p = room.players.find(pl => pl.id === socket.id);
  return !!p && p.userId === room.hostUserId;
};

function activePlayers(room: Room) { return room.players.filter(p => !!p.id); }
export function snapshotPublicRooms() {
  const arr: Array<{code:string; name:string|null; status:'lobby'|'running'|'ended'; players:number; maxPlayers:number; url:string}> = [];
  for (const room of rooms.values()) {
    const isPrivate = !!room.params?.private;
    if (isPrivate) continue;
    const players = activePlayers(room).length;
    const maxPlayers = Number(room.params?.maxPlayers ?? 10);
    const status = room.status;
    const code = room.code;
    const url = status === 'running'
      ? `https://niwot.btsinfo.nc/quiz/${code}`
      : `https://niwot.btsinfo.nc/rooms/${code}`;
    arr.push({
      code,
      name: room.name ?? null,
      status,
      players,
      maxPlayers,
      url
    });
  }
  // On peut trier: running d'abord, puis par nb joueurs desc
  return arr.sort((a,b)=>{
    if (a.status!==b.status) return a.status==='running' ? -1 : 1;
    if (b.players!==a.players) return b.players - a.players;
    return a.code.localeCompare(b.code);
  });
}

function roomPublic(room: Room) {
  const actives = activePlayers(room);
  return {
    code: room.code,
    hostUserId: room.hostUserId,
    params: room.params,
    players: actives.map(p => ({
      userId: p.userId, username: p.username, avatar: p.avatar || null,
      points: p.points, ready: p.ready
    })),
    status: room.status
  };
}

function toAbsoluteImage(url?: string|null) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  const base = process.env.PUBLIC_UPLOADS_BASE || "https://api-game.niwot.btsinfo.nc";
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

async function hydrateRoomFromDB(code: string): Promise<Room|null> {
  const db: any = await prisma.room.findUnique({
    where: { code }, include: { members: { include: { user: true } } }
  } as any);
  if (!db) return null;

  const params: RoomParams = {
    private: (db.visibility ?? db.isPrivate) === 'private' || !!db.isPrivate,
    maxPlayers: Number(db.maxPlayers ?? 10),
    excludedUsernames: Array.isArray(db.excludedUsernames) ? db.excludedUsernames : [],
    categories: Array.isArray(db.categories) ? db.categories.map((x:any)=>Number(x)) : [],
    answerTimeSec: Number(db.answerTimeSec ?? 15),
    targetPoints: Number(db.targetPoints ?? 100),
    scoring: (db.pointMode === 'fixed' || db.scoring === 'fixe') ? 'fixe' : 'degressif',
    showProposals: !!(db.showProposals ?? true),

    approvedOnly: true,
    preCountdownSec: 0,
    resultDelaySec: 5,
    allowJoinMidQuiz: true,
  };

  const players: Player[] = (db.members ?? []).map((m:any) => ({
    id: "",
    userId: Number(m.userId ?? m.user?.id),
    username: String(m.user?.username ?? m.username ?? 'user'),
    avatar: m.user?.profileImage ?? null,
    points: 0, ready: false
  }));

  const room: Room = { name: (db as any).name ?? null, code,
    hostId: "",
    hostUserId: Number(db.ownerId ?? db.hostUserId ?? players[0]?.userId ?? 0),
    params, players, status: 'lobby',
    currentQuestion: null, proposals: {},
    roundStartsAt: null, roundEndsAt: null, timeout: null, firstFinder: undefined
  };
  return room;
}
async function ensureRoomFromDB(code: string): Promise<Room|null> {
  if (rooms.has(code)) return rooms.get(code)!;
  const room = await hydrateRoomFromDB(code);
  if (!room) return null;
  rooms.set(code, room);
  return room;
}
async function refreshParamsFromDB(room: Room) {
  try {
    const db: any = await prisma.room.findUnique({ where: { code: room.code } } as any);
    if (!db) return;
    room.params.targetPoints = Number(db.targetPoints ?? room.params.targetPoints);
    room.params.answerTimeSec = Number(db.answerTimeSec ?? room.params.answerTimeSec);
    room.params.showProposals = !!(db.showProposals ?? room.params.showProposals);
    room.params.maxPlayers = Number(db.maxPlayers ?? room.params.maxPlayers);
    room.params.excludedUsernames = Array.isArray(db.excludedUsernames) ? db.excludedUsernames : (room.params.excludedUsernames||[]);
    if (db.pointMode || db.scoring) room.params.scoring = (db.pointMode === 'fixed' || db.scoring === 'fixe') ? 'fixe' : 'degressif';
    if (Array.isArray(db.categories)) room.params.categories = db.categories.map((x:any)=>Number(x));
  } catch (e) { log("refreshParams:error", room.code, e); }
}

/** Tirage d'une question avec fallback SQL quand Prisma ne retourne rien (relations M2M) */
async function nextQuestion(io: Server, room: Room) {
  const approvedOnly = room.params.approvedOnly !== false;
  const statuses = approvedOnly ? ["approved"] : ["approved","awaiting_approval"];
  const catIds = Array.isArray(room.params.categories) ? room.params.categories.map((x:any)=>Number(x)).filter(Number.isFinite) : [];

  let q: any = null;

  // --- Essai Prisma (marche si la relation "categories" est bien nommée ainsi dans le schema)
  try {
    const where: any = {};
    if (approvedOnly) where.status = 'approved' as any;
    else where.status = { in: statuses as any } as any;
    if (catIds.length) where.categories = { some: { id: { in: catIds } } } as any;

    const total = await prisma.question.count({ where } as any).catch(()=>0);
    if (total > 0) {
      const skip = Math.floor(Math.random() * Math.max(1, total));
      q = (await prisma.question.findMany({
        where,
        include: { createdBy: { select: { id:true, username:true } } as any, categories: true as any },
        skip, take:1
      } as any).catch(()=>[]))[0] || null;
    }
  } catch (e) {
    // on teste le fallback
  }

  // --- Fallback SQL (robuste à la M2M _CategoryToQuestion)
  if (!q) {
    try {
      const statusesList = statuses.map(s=>`'${s}'`).join(", ");
      let sql = "";
      if (catIds.length) {
        sql = `
          SELECT q.id
          FROM Question q
          JOIN _CategoryToQuestion ct ON ct.B = q.id
          WHERE q.status IN (${statusesList})
            AND ct.A IN (${catIds.join(",")})
          GROUP BY q.id
          ORDER BY RAND()
          LIMIT 1
        `;
      } else {
        sql = `
          SELECT q.id
          FROM Question q
          WHERE q.status IN (${statusesList})
          ORDER BY RAND()
          LIMIT 1
        `;
      }
      const rows: any[] = await (prisma as any).$queryRawUnsafe(sql);
      const id = rows?.[0]?.id ? Number(rows[0].id) : null;
      if (id) {
        q = await prisma.question.findUnique({
          where: { id },
          include: { createdBy: { select: { id:true, username:true } } as any, categories: true as any }
        } as any);
      }
    } catch (e) {
      // ignore
    }
  }

  if (!q) {
    io.to(room.code).emit("quiz:ended", { reason: "Aucune question disponible selon les paramètres." });
    room.status='ended';
    return;
  }

  const type: 'CITATION'|'IMAGE'|'TEXT' =
    q.type ? q.type :
    (q.citationText ? 'CITATION' : ((q.imagePath || q.imageUrl) ? 'IMAGE' : 'TEXT'));

  room.currentQuestion = {
    id: Number(q.id),
    text: String(q.text ?? ''),
    type,
    citationText: q.citationText ?? null,
    imagePath: toAbsoluteImage(q.imagePath ?? q.imageUrl ?? null),
    answer: normalizeAnswer(q.answer),
    alternatives: (Array.isArray(q.alternatives)? q.alternatives:[]).map((a:any)=>normalizeAnswer(String(a))),
    explanation: q.explanation ?? null,
    createdBy: q.createdBy ? { id: Number(q.createdBy.id), username: String(q.createdBy.username) } : null,
    categories: (q.categories ?? []).map((c:any)=>({ id: Number(c.id), name: String(c.name ?? '') }))
  };

  room.players.forEach(p => p.answered = false);
  room.proposals = {};
  room.firstFinder = undefined;

  const now = Date.now();
  const pre = Math.max(0, Number(room.params.preCountdownSec ?? 0)) * 1000;
  const startsAt = now + pre;
  const endsAt   = startsAt + (Math.max(5, Number(room.params.answerTimeSec ?? 15)) * 1000);
  room.roundStartsAt = startsAt;
  room.roundEndsAt   = endsAt;

  if (room.timeout) clearTimeout(room.timeout);
  room.timeout = setTimeout(() => endRound(io, room), pre + (room.params.answerTimeSec * 1000));

  log("question:emit", room.code, { id: room.currentQuestion.id, startsAt, endsAt, type: room.currentQuestion.type });
  io.to(room.code).emit("quiz:question", {
    serverNow: now,
    params: room.params,
    question: {
      id: room.currentQuestion.id, text: room.currentQuestion.text, type: room.currentQuestion.type,
      citationText: room.currentQuestion.citationText, imagePath: room.currentQuestion.imagePath
    },
    startsAt, endsAt
  });
}

function publicProposals(room: Room) {
  if (!room.params.showProposals) return [];
  const arr: Array<{userId:number;username:string;avatar:string|null;points:number;guess:string}> = [];
  const correct = room.currentQuestion?.answer;
  const alts = new Set(room.currentQuestion?.alternatives || []);
  for (const [sid, guess] of Object.entries(room.proposals || {})) {
    if (guess === correct || alts.has(guess)) continue;
    const p = room.players.find(pl => pl.id === sid);
    if (!p) continue;
    arr.push({ userId: p.userId, username: p.username, avatar: p.avatar || null, points: p.points, guess });
  }
  return arr;
}

async function endRound(io: Server, room: Room) {
  if (!room.currentQuestion) return;
  io.to(room.code).emit("quiz:proposals", publicProposals(room));
  io.to(room.code).emit("quiz:result", {
    correct: room.currentQuestion.answer, first: room.firstFinder || null,
    explanation: room.currentQuestion.explanation, createdBy: room.currentQuestion.createdBy?.username
  });

  const winner = room.players.find(p => p.points >= room.params.targetPoints);
  if (winner) {
    room.status = 'ended';
    try { await prisma.user.update({ where: { id: winner.userId }, data: { wins: { increment: 1 } } } as any); } catch {}
    const top = activePlayers(room).sort((a,b)=>b.points-a.points).slice(0,3).map(p=>({ username:p.username, points:p.points }));
    io.to(room.code).emit("quiz:ended", { top });
    return;
  }

  const delay = Math.max(0, Number(room.params.resultDelaySec ?? 5)) * 1000;
  setTimeout(()=> nextQuestion(io, room), delay);
}

function ensureUploadsDir() {
  const up = path.join(process.cwd(), "uploads");
  try { fs.mkdirSync(up, { recursive: true }); } catch {}
  return up;
}

function decodeBase64Image(dataURI: string) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\n\r]+)$/.exec(dataURI || "");
  if (!match) return null;
  const mime = match[1];
  const buf = Buffer.from(match[2], "base64");
  let ext = ".bin";
  if (mime === "image/png") ext = ".png";
  else if (mime === "image/jpeg") ext = ".jpg";
  else if (mime === "image/webp") ext = ".webp";
  else if (mime === "image/gif") ext = ".gif";
  return { buf, ext, mime };
}

export function initSockets(io: Server) {
  io.on("connection", (socket: Socket) => {
    socket.on("auth:hello", ({ userId }: { userId:number }, cb?: Function) => {
      if (typeof userId === "number" && userId > 0) { socketUsers.set(socket.id, userId); cb?.({ ok:true }); }
      else cb?.({ ok:false, error:"invalid_userId" });
    });

    socket.on("profile:update", async (payload: {
      username?: string;
      oldPassword?: string;
      newPassword?: string;
      confirmPassword?: string;
      avatarBase64?: string;
    }, cb?: Function) => {
      const authUserId = socketUsers.get(socket.id);
      if (!authUserId) return cb?.({ ok:false, error:"not_authenticated" });

      try {
        const user: any = await prisma.user.findUnique({ where: { id: authUserId } } as any);
        if (!user) return cb?.({ ok:false, error:"user_not_found" });

        const data: any = {};
        if (payload.username && payload.username.trim() && payload.username.trim() !== user.username) {
          data.username = payload.username.trim();
        }
        if (payload.oldPassword || payload.newPassword || payload.confirmPassword) {
          if (!payload.oldPassword || !payload.newPassword || !payload.confirmPassword) return cb?.({ ok:false, error:"missing_password_fields" });
          if (payload.newPassword !== payload.confirmPassword) return cb?.({ ok:false, error:"password_mismatch" });
          const bcrypt = await import("bcryptjs");
          const currentHash: string = user.passwordHash || user.password || "";
          const ok = currentHash ? await bcrypt.compare(payload.oldPassword, currentHash) : false;
          if (!ok) return cb?.({ ok:false, error:"bad_old_password" });
          const newHash = await bcrypt.hash(payload.newPassword, 10);
          data.passwordHash = newHash;
        }
        if (payload.avatarBase64) {
          const dec = decodeBase64Image(payload.avatarBase64);
          if (!dec) return cb?.({ ok:false, error:"bad_image" });
          const uploadsDir = ensureUploadsDir();
          const fname = `avatar-${Date.now()}-${Math.floor(Math.random()*1e9)}${dec.ext}`;
          const fpath = path.join(uploadsDir, fname);
          fs.writeFileSync(fpath, dec.buf);
          data.profileImage = `/uploads/${fname}`;
        }

        if (Object.keys(data).length === 0) return cb?.({ ok:true, user: { id: user.id, username: user.username, profileImage: user.profileImage ?? null } });

        const updated = await prisma.user.update({ where: { id: user.id }, data } as any);
        cb?.({ ok:true, user: { id: updated.id, username: updated.username, profileImage: updated.profileImage ?? null } });
      } catch (e:any) { log("profile:update:error", e?.message || e); cb?.({ ok:false, error:"update_failed" }); }
    });

    // ---- ROOM / QUIZ ----

    socket.on("room:join", async ({ code, username, userId, avatar }: any, cb) => {
      code = String(code||"").toUpperCase();
      let room = rooms.get(code);
      if (!room) {
        room = await ensureRoomFromDB(code) ?? await hydrateRoomFromDB(code) ?? { name: null, code, hostId: socket.id, hostUserId: Number(userId),
          params: {
            private:false, maxPlayers:10, excludedUsernames:[], categories:[],
            answerTimeSec:15, targetPoints:100, scoring:'degressif', showProposals:true,
            approvedOnly:true, preCountdownSec:0, resultDelaySec:5, allowJoinMidQuiz:true
          },
          players: [], status:'lobby', proposals:{}, roundStartsAt:null, roundEndsAt:null, timeout:null, firstFinder: undefined
        };
        rooms.set(code, room);
      }

      if (!socketUsers.get(socket.id) && typeof userId === "number") socketUsers.set(socket.id, Number(userId));

      const banned = (room.params.excludedUsernames || []).some(u => u?.toLowerCase?.() === String(username).toLowerCase());
      if (banned) return cb?.({ error: "banned" });

      const exists = room.players.find(p => p.userId === Number(userId));
      if (!exists) {
        if (room.players.length >= room.params.maxPlayers) return cb?.({ error: "Salle pleine" });
        room.players.push({ id: socket.id, userId: Number(userId), username, avatar, points: 0, ready: false });
      } else { exists.id = socket.id; exists.username = username; exists.avatar = avatar; }

      if (!room.hostId && Number(userId) === room.hostUserId) {
        room.hostId = socket.id;
      } else if (!room.hostId && !room.hostUserId) {
        room.hostId = socket.id; room.hostUserId = Number(userId);
        try { await prisma.room.update({ where: { code }, data: { ownerId: room.hostUserId } } as any); } catch {}
      }

      socket.join(code);
      log("join", code, "by", username, `#${userId}`, "players:", room.players.map(p=>({u:p.username, id:!!p.id})));
      io.to(code).emit("room:update", roomPublic(room));
      cb?.({ ok:true });

      if (room.status === 'running' && room.currentQuestion) {
        const startsAt = room.roundStartsAt ?? Date.now();
        const endsAt   = room.roundEndsAt   ?? (startsAt + room.params.answerTimeSec * 1000);
        socket.emit("quiz:question", {
          serverNow: Date.now(),
          params: room.params,
          question: {
            id: room.currentQuestion.id, text: room.currentQuestion.text, type: room.currentQuestion.type,
            citationText: room.currentQuestion.citationText, imagePath: room.currentQuestion.imagePath
          },
          startsAt, endsAt
        });
        socket.emit("quiz:proposals", publicProposals(room));
      }
    });

    socket.on("room:leave", async ({ code }, cb?: Function) => {
      code = String(code||"").toUpperCase();
      const room = rooms.get(code);
      if (!room) { cb?.({ ok:true }); return; }

      const player = room.players.find(p => p.id === socket.id);
      const wasHost = !!player && player.userId === room.hostUserId;

      try { socket.leave(code); } catch {}
      if (player) player.id = "";

      if (wasHost) {
        const act = activePlayers(room);
        if (act.length) {
          room.hostId = act[0].id; room.hostUserId = act[0].userId;
          try { await prisma.room.update({ where: { code }, data: { ownerId: room.hostUserId } } as any); } catch {}
        } else {
          room.hostId = "";
          try { await prisma.room.update({ where: { code }, data: { ownerId: null } } as any); } catch {}
          room.hostUserId = 0;
        }
      }

      io.to(code).emit("room:update", roomPublic(room));
      cb?.({ ok:true });
    });

    socket.on("room:config", async ({ code, params }, cb) => {
      code = String(code||"").toUpperCase();
      const room = rooms.get(code); if (!room) return cb?.({ error:"Salle introuvable" });

      const p = { ...room.params, ...params };

      p.maxPlayers    = Math.max(2, Math.min(20, Number(p.maxPlayers   ?? room.params.maxPlayers)));
      p.answerTimeSec = Math.max(5, Math.min(60, Number(p.answerTimeSec?? room.params.answerTimeSec)));
      p.targetPoints  = Math.max(10, Math.min(1000, Number(p.targetPoints ?? room.params.targetPoints)));
      p.scoring       = (p.scoring === 'fixe' ? 'fixe' : 'degressif');
      p.showProposals = !!p.showProposals;
      p.private       = !!p.private;
      p.categories    = Array.isArray(p.categories)? p.categories.map((x:any)=>Number(x)) : room.params.categories;

      // invisibles dans l'UI mais fixés côté front
      p.approvedOnly    = true;
      p.preCountdownSec = 0;

      room.params = p;
      io.to(code).emit("room:update", roomPublic(room));

      try {
        await prisma.room.update({
          where: { code },
          data: {
            maxPlayers: p.maxPlayers,
            answerTimeSec: p.answerTimeSec,
            targetPoints: p.targetPoints,
            pointMode: (p.scoring === 'fixe' ? 'fixed' : 'degressif'),
            showProposals: p.showProposals,
            excludedUsernames: p.excludedUsernames,
            categories: p.categories
          } as any
        } as any);
      } catch (e) {
        log("room:config:persist:error", code, e);
      }
      cb?.({ ok:true });
    });

    socket.on("room:kick", ({ code, userId }, cb) => {
      code = String(code||"").toUpperCase();
      const room = rooms.get(code); if (!room) return cb?.({ ok:false, error:"room_not_found" });
      if (!isHostSocket(socket, room)) return cb?.({ ok:false, error:"not_host" });
      const target = room.players.find(p => p.userId === Number(userId));
      if (!target) return cb?.({ ok:false, error:"user_not_found" });

      const s = io.sockets.sockets.get(target.id);
      try { s?.emit("room:kicked", { code }); } catch {}
      try { s?.leave(code); s?.disconnect(true); } catch {}
      target.id = "";

      if (target.userId === room.hostUserId) {
        const act = room.players.find(p => !!p.id);
        if (act) { room.hostId = act.id; room.hostUserId = act.userId; try { prisma.room.update({ where: { code }, data: { ownerId: room.hostUserId } } as any); } catch {} }
        else { room.hostId = ""; }
      }

      io.to(code).emit("room:update", roomPublic(room));
      cb?.({ ok:true });
    });

    socket.on("room:ban", async ({ code, userId }, cb) => {
      code = String(code||"").toUpperCase();
      const room = rooms.get(code); if (!room) return cb?.({ ok:false, error:"room_not_found" });
      if (!isHostSocket(socket, room)) return cb?.({ ok:false, error:"not_host" });
      const target = room.players.find(p => p.userId === Number(userId));
      if (!target) return cb?.({ ok:false, error:"user_not_found" });

      const uname = String(target.username || "").trim();
      if (uname && !room.params.excludedUsernames.some(u => u?.toLowerCase?.() === uname.toLowerCase())) {
        room.params.excludedUsernames.push(uname);
        try {
          await prisma.room.update({
            where: { code },
            data: { excludedUsernames: room.params.excludedUsernames } as any
          } as any);
        } catch (e) { log("room:ban:persist:error", code, e); }
      }

      const s = io.sockets.sockets.get(target.id);
      try { s?.emit("room:banned", { code }); } catch {}
      try { s?.leave(code); s?.disconnect(true); } catch {}
      target.id = "";

      if (target.userId === room.hostUserId) {
        const act = room.players.find(p => !!p.id);
        if (act) { room.hostId = act.id; room.hostUserId = act.userId; try { prisma.room.update({ where: { code }, data: { ownerId: room.hostUserId } } as any); } catch {} }
        else { room.hostId = ""; }
      }

      io.to(code).emit("room:update", roomPublic(room));
      cb?.({ ok:true });
    });

    socket.on("room:unban", async ({ code, username }, cb) => {
      code = String(code||"").toUpperCase();
      const room = rooms.get(code); if (!room) return cb?.({ ok:false, error:"room_not_found" });
      if (!isHostSocket(socket, room)) return cb?.({ ok:false, error:"not_host" });

      const uname = String(username||"").trim();
      if (!uname) return cb?.({ ok:false, error:"bad_username" });

      const before = room.params.excludedUsernames || [];
      const after = before.filter(u => (u||"").toLowerCase() !== uname.toLowerCase());
      room.params.excludedUsernames = after;

      try {
        await prisma.room.update({ where: { code }, data: { excludedUsernames: after } } as any);
      } catch (e) { log("room:unban:persist:error", code, e); }

      io.to(code).emit("room:update", roomPublic(room));
      cb?.({ ok:true, excludedUsernames: after });
    });

    const startHandler = async ({ code }: any, cb?: Function) => {
      code = String(code||"").toUpperCase();
      const room = rooms.get(code); if (!room) return cb?.({ error:"room_not_found" });
      if (!isHostSocket(socket, room)) return cb?.({ error: "not_host" });

      await refreshParamsFromDB(room);
      room.status = 'running';

      io.to(code).emit("room:update", roomPublic(room));
      io.to(code).emit("room:started", { code });

      activePlayers(room).forEach(p => { p.points = 0; p.answered = false; });

      log("start:ok", code, "launching first question");
      await nextQuestion(io, room);
      cb?.({ ok:true });
    };
    socket.on("room:start", startHandler);

    socket.on("quiz:restart", async ({ code }, cb) => {
      code = String(code||"").toUpperCase();
      const room = rooms.get(code);
      if (!room) { cb?.({ ok:false, error:"room_not_found" }); return; }
      if (!isHostSocket(socket, room)) { cb?.({ ok:false, error:"not_host" }); return; }

      if (room.timeout) { clearTimeout(room.timeout); room.timeout = null; }

      await refreshParamsFromDB(room);
      room.status = 'running';
      room.currentQuestion = null;
      room.roundStartsAt = null;
      room.roundEndsAt = null;
      room.players.forEach(p => { p.points = 0; p.answered = false; });

      io.to(code).emit("room:update", roomPublic(room));
      io.to(code).emit("room:started", { code });

      log("restart", code);
      nextQuestion(io, room)
        .then(()=> cb?.({ ok:true }))
        .catch((e)=> { log("restart:err", code, e); cb?.({ ok:false, error:"nextQuestion_failed" }); });
    });

    socket.on("quiz:gotoRoom", ({ code }, cb) => {
      code = String(code||"").toUpperCase();
      const room = rooms.get(code);
      if (!room) { cb?.({ ok:false, error:"room_not_found" }); return; }
      if (!isHostSocket(socket, room)) { cb?.({ ok:false, error:"not_host" }); return; }

      if (room.timeout) { clearTimeout(room.timeout); room.timeout = null; }
      room.status = 'lobby';
      room.currentQuestion = null;
      room.roundStartsAt = null;
      room.roundEndsAt = null;

      io.to(code).emit("room:update", roomPublic(room));
      const url = `https://niwot.btsinfo.nc/rooms/${code}`;
      io.to(code).emit("quiz:gotoRoom", { code, url });
      log("gotoRoom:broadcast", code, url);
      cb?.({ ok:true, url });
    });

    socket.on("quiz:answer", ({ code, answer }, cb) => {
      code = String(code||"").toUpperCase();
      const room = rooms.get(code); if (!room || room.status !== 'running' || !room.currentQuestion) return;

      const norm = normalizeAnswer(String(answer || ""));
      if (!room.proposals) room.proposals = {};
      room.proposals[socket.id] = norm;

      const correct = norm === room.currentQuestion.answer || room.currentQuestion.alternatives.includes(norm);
      if (correct) {
        const player = room.players.find(p => p.id === socket.id);
        if (player && !player.answered) {
          player.answered = true;
          if (room.params.scoring === 'degressif') {
            const order = room.players.filter(p => p.answered).length;
            const points = Math.max(1, 11 - order);
            player.points += points;
          } else { player.points += 10; }
          if (!room.firstFinder) room.firstFinder = player.username;
          io.to(code).emit("room:update", roomPublic(room));
        }
      }

      cb?.({ correct });
      io.to(code).emit("quiz:proposals", publicProposals(room));

      const actives = activePlayers(room);
      const allAnswered = actives.length > 0 && actives.every(p => p.answered);
      if (allAnswered && room.timeout) { clearTimeout(room.timeout); room.timeout = null; endRound(io, room); }
    });

    socket.on("room:host:transfer", async ({ code, userId }, cb) => {
      code = String(code||"").toUpperCase();
      const room = rooms.get(code); if (!room) return cb?.({ error:"room_not_found" });
      if (!isHostSocket(socket, room)) return cb?.({ error: "not_host" });

      const target = room.players.find(p => p.userId === Number(userId) && !!p.id);
      if (!target) return cb?.({ error:"target_not_connected" });

      room.hostId = target.id; room.hostUserId = target.userId;
      try { await prisma.room.update({ where: { code }, data: { ownerId: room.hostUserId } } as any); } catch (e) { log("host:transfer:persist:error", code, e); }

      log("host:transfer", code, "->", target.username);
      io.to(code).emit("room:update", roomPublic(room));
      cb?.({ ok:true });
    });

    socket.on("disconnect", () => {
      socketUsers.delete(socket.id);
      for (const [code, room] of rooms) {
        const wasHost = room.hostId === socket.id;
        room.players.forEach(p => { if (p.id === socket.id) p.id = ""; });
        if (wasHost) { room.hostId = ""; }
        io.to(code).emit("room:update", roomPublic(room));
      }
    });
  });
}
