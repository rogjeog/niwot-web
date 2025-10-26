import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { api } from "../lib/api";
import { avatarUrl } from "../lib/media";

type Leader = { id:number; username:string; wins:number; profileImage?:string|null };
type Proposer = { id:number; username:string; approvedCount:number; profileImage?:string|null };
type PubRoom = {
  code: string;
  name: string|null;
  status: "lobby"|"running"|"ended";
  players: number;
  maxPlayers: number;
  url: string;
};

export default function LobbyPage() {
  const router = useRouter();
  const [roomName, setRoomName] = useState("");
  const [visibility, setVisibility] = useState<"public"|"private">("public");
  const [joinCode, setJoinCode] = useState("");
  const [busyCreate, setBusyCreate] = useState(false);
  const [busyJoin, setBusyJoin] = useState(false);
  const [err, setErr] = useState("");

  // Public rooms
  const [pubRooms, setPubRooms] = useState<PubRoom[]>([]);
  const [loadingPub, setLoadingPub] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Leaderboards
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [proposers, setProposers] = useState<Proposer[]>([]);

  // --- Fetch leaderboards ---
  useEffect(() => {
    // Top joueurs (wins) — tolère leaders/top (compat)
    api.get("/leaderboard").then(r => {
      const d = r?.data ?? {};
      const arr = Array.isArray(d.leaders) ? d.leaders
               : Array.isArray(d.top)     ? d.top
               : Array.isArray(d)         ? d
               : [];
      const norm = arr.slice(0, 10).map((u:any) => ({
        id: Number(u.id),
        username: String(u.username ?? ""),
        wins: Number(u.wins ?? 0),
        profileImage: u.profileImage ?? null,
      }));
      setLeaders(norm);
    }).catch(()=>{});

    // Top proposeurs (approved)
    api.get("/leaderboard/proposers").then(r => {
      const d = r?.data ?? {};
      const arr = Array.isArray(d.proposers) ? d.proposers
               : Array.isArray(d)           ? d
               : [];
      const norm = arr.slice(0, 10).map((u:any) => ({
        id: Number(u.id),
        username: String(u.username ?? ""),
        approvedCount: Number(u.approvedCount ?? 0),
        profileImage: u.profileImage ?? null,
      }));
      setProposers(norm);
    }).catch(()=>{});
  }, []);

  // --- Public rooms ---
  const loadPublic = useCallback(async () => {
    try {
      setRefreshing(true);
      const r = await api.get("/rooms/public");
      const d = r?.data ?? {};
      const arr = Array.isArray(d.rooms) ? d.rooms : [];
      const norm: PubRoom[] = arr.map((x:any) => ({
        code: String(x.code || ""),
        name: x.name == null ? null : String(x.name),
        status: (x.status === "running" || x.status === "ended") ? x.status : "lobby",
        players: Number(x.players ?? 0),
        maxPlayers: Number(x.maxPlayers ?? 10),
        url: String(x.url || (`/rooms/${String(x.code||"")}`)),
      }));
      setPubRooms(norm);
      setLoadingPub(false);
    } catch {
      setPubRooms([]);
      setLoadingPub(false);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadPublic(); }, [loadPublic]);

  const onCreate = async () => {
    setErr("");
    setBusyCreate(true);
    try {
      const payload: any = { visibility };
      if (roomName.trim()) payload.name = roomName.trim();
      const r = await api.post("/rooms", payload);
      const code = r?.data?.room?.code || r?.data?.code;
      if (!code) throw new Error("Code de salle manquant (réponse API)");
      await router.push(`/rooms/${String(code).toUpperCase()}`);
    } catch (e:any) {
      setErr(e?.response?.data?.error || e?.message || "Erreur lors de la création");
    } finally {
      setBusyCreate(false);
    }
  };

  const onJoin = async () => {
    setErr("");
    const code = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      setErr("Code invalide (6 caractères A-Z/0-9)");
      return;
    }
    setBusyJoin(true);
    try {
      await api.post(`/rooms/${code}/join`, {});
      await router.push(`/rooms/${code}`);
    } catch (e:any) {
      setErr(e?.response?.data?.error || e?.message || "Impossible de rejoindre la salle");
    } finally {
      setBusyJoin(false);
    }
  };

  const joinPublic = async (code: string, url: string) => {
    setErr("");
    try {
      await api.post(`/rooms/${code}/join`, {});
      if (/^https?:\/\//i.test(url)) window.location.href = url;
      else await router.push(url);
    } catch (e:any) {
      setErr(e?.response?.data?.error || e?.message || "Impossible de rejoindre la salle");
    }
  };

  // N'afficher que les salles avec au moins 1 joueur
  const shownRooms = pubRooms.filter(r => r.players > 0);

  return (
    <main className="mx-auto max-w-5xl px-4 pt-8 space-y-8">
      {err && <div className="card p-4 text-red-400">{err}</div>}

      <div className="grid md:grid-cols-2 gap-6">
        <div className="card p-6 space-y-4">
          <h1 className="text-xl font-semibold">Créer une salle</h1>
          <div>
            <div className="label">Nom de la salle</div>
            <input className="input" value={roomName} onChange={(e)=>setRoomName(e.target.value)} placeholder="(Défaut : Salle de &lt;votre pseudo&gt;)" />
          </div>
          <div>
            <div className="label">Visibilité</div>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="vis" checked={visibility==="public"} onChange={()=>setVisibility("public")} />
                <span>Publique</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="vis" checked={visibility==="private"} onChange={()=>setVisibility("private")} />
                <span>Privée</span>
              </label>
            </div>
          </div>
          <button className="btn" onClick={onCreate} disabled={busyCreate}>{busyCreate ? "Création…" : "Créer la salle"}</button>
        </div>

        <div className="card p-6 space-y-4">
          <h2 className="text-lg font-semibold">Rejoindre une salle</h2>
          <div>
            <div className="label">Code (A-Z et chiffres, 6)</div>
            <input className="input uppercase tracking-widest" maxLength={6} value={joinCode}
                   onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,""))}
                   placeholder="ABC123" />
          </div>
          <button className="btn" onClick={onJoin} disabled={busyJoin}>{busyJoin ? "Connexion…" : "Rejoindre"}</button>
        </div>
      </div>

      {/* --- SALLES PUBLIQUES --- */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Salles publiques en cours</h2>
          <button className="btn" onClick={loadPublic} disabled={refreshing}>
            {refreshing ? "Rafraîchissement…" : "Rafraîchir"}
          </button>
        </div>

        {loadingPub ? (
          <div className="text-sm text-white/60">Chargement…</div>
        ) : shownRooms.length === 0 ? (
          <div className="text-sm text-white/60">Aucune salle publique avec des joueurs pour le moment.</div>
        ) : (
          <ul className="divide-y divide-white/10">
            {shownRooms.map((r) => (
              <li key={r.code} className="py-3 flex items-center gap-3">
                <div className="flex-1">
                  <div className="font-medium">
                    {r.name || `Salle ${r.code}`}
                    <span className="ml-2 text-xs text-white/50 align-middle">[{r.code}]</span>
                  </div>
                  <div className="text-xs text-white/60">
                    {r.players}/{r.maxPlayers} · {r.status === "running" ? "En cours" : "Salle d'attente"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="text-sm px-3 py-1.5 rounded bg-emerald-600/80 hover:bg-emerald-600"
                          onClick={()=>joinPublic(r.code, r.url)}>
                    Rejoindre
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* --- TOPS --- */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Top joueurs */}
        <div className="card p-6 space-y-4">
          <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Top 10 joueurs</h2></div>
          {leaders.length === 0 ? (
            <div className="text-white/60 text-sm">Pas encore de classement.</div>
          ) : (
            <ul className="divide-y divide-white/10">
              {leaders.map((u, i) => (
                <li key={u.id} className="py-2 flex items-center gap-3">
                  <div className="w-6 text-right tabular-nums">{i+1}.</div>
                  <img
                    src={avatarUrl(u.profileImage || null)}
                    alt=""
                    className="h-9 w-9 rounded-full object-cover border border-white/10"
                  />
                  <div className="flex-1">
                    <div className="font-medium leading-tight">{u.username}</div>
                    <div className="text-xs text-white/60 leading-tight">Wins</div>
                  </div>
                  <div className="text-base font-semibold tabular-nums">{u.wins}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Top proposeurs (approved) */}
        <div className="card p-6 space-y-4">
          <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Top 10 contributeurs</h2><a href="/suggest" className="btn">Proposer des questions</a></div>
          {proposers.length === 0 ? (
            <div className="text-white/60 text-sm">Aucun contributeur pour le moment.</div>
          ) : (
            <ul className="divide-y divide-white/10">
              {proposers.map((u, i) => (
                <li key={u.id} className="py-2 flex items-center gap-3">
                  <div className="w-6 text-right tabular-nums">{i+1}.</div>
                  <img
                    src={avatarUrl(u.profileImage || null)}
                    alt=""
                    className="h-9 w-9 rounded-full object-cover border border-white/10"
                  />
                  <div className="flex-1">
                    <div className="font-medium leading-tight">{u.username}</div>
                    <div className="text-xs text-white/60 leading-tight">Questions approuvées</div>
                  </div>
                  <div className="text-base font-semibold tabular-nums">{u.approvedCount}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
