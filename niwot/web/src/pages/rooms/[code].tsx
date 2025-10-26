import { useRouter } from "next/router";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { io, Socket } from "socket.io-client";
import { avatarUrl } from "../../lib/media";

type Member = { userId:number; username:string; profileImage?:string|null; isHost:boolean };
type RoomHTTP = {
  code:string; name:string; hostId:number; youAreHost:boolean;
  members: Member[];
  settings: {
    visibility:'public'|'private';
    maxPlayers:number;
    categories:number[];
    answerTimeSec:number;
    targetPoints:number;
    pointMode:'degressive'|'fixed';
    showProposals:boolean;
  };
};
type PlayerWS = { userId:number; username:string; avatar?:string|null; points:number; ready:boolean };
type RoomWS = {
  code:string;
  hostUserId:number;
  params: {
    private:boolean;
    maxPlayers:number;
    categories:number[];
    answerTimeSec:number;
    targetPoints:number;
    scoring:'degressif'|'fixe';
    showProposals:boolean;

    // champs avancés restants côté WS, on ne les expose plus dans l'UI
    approvedOnly?: boolean;
    preCountdownSec?: number;
    resultDelaySec?: number;
    excludedUsernames?: string[];
  };
  players:PlayerWS[];
  status:'lobby'|'running'|'ended';
};
type Cat = { id:number; name:string; approvedCount?:number };

const WS = (process.env.NEXT_PUBLIC_WS_BASE || "wss://api-game.niwot.btsinfo.nc") as string;

const Crown = () => (
  <svg viewBox="0 0 24 24" className="inline h-4 w-4 ml-1 align-middle">
    <path fill="currentColor" d="M5 18h14l-1-8-4 3-3-5-3 5-4-3-1 8zm-2 2a1 1 0 0 1-1-1l1.2-9.6a1 1 0 0 1 1.6-.7l3.71 2.78 2.8-4.67a1 1 0 0 1 1.72 0l2.8 4.67 3.71-2.78a1 1 0 0 1 1.6.7L22 19a1 1 0 0 1-1 1H3z"/>
  </svg>
);

export default function RoomPage() {
  const router = useRouter();
  const code = String(router.query.code||"").toUpperCase();
  const codeRef = useRef(code); codeRef.current = code;

  const [me, setMe] = useState<any>(null);
  const [roomHTTP, setRoomHTTP] = useState<RoomHTTP|null>(null);
  const [roomWS, setRoomWS] = useState<RoomWS|null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [socket, setSocket] = useState<Socket|null>(null);

  // --- Paramètres (form)
  const [showParams, setShowParams] = useState(false);
  const [cats, setCats] = useState<Cat[]>([]);
  const [form, setForm] = useState({
    private: false,
    maxPlayers: 10,
    answerTimeSec: 15,
    targetPoints: 100,
    scoring: "degressif" as "degressif"|"fixe",
    showProposals: true,
    categories: [] as number[],

    // on garde en state pour cohérence, mais on ne les affiche plus
    resultDelaySec: 5,
    excludedUsernames: [] as string[],
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string|null>(null);

  // rejoin
  const joinPayloadRef = useRef<any>(null);
  const rejoinTimerRef = useRef<any>(null);

  const isHost = useMemo(()=>{
    if (!me) return false;
    if (roomWS) return roomWS.hostUserId === me.id;
    if (roomHTTP) return roomHTTP.youAreHost;
    return false;
  },[me, roomHTTP, roomWS]);

  // hydrate form depuis les données salle
  const hydrateFormFromState = (rws?: RoomWS|null, rhttp?: RoomHTTP|null)=>{
    const p: any = rws?.params || rhttp?.settings || {};
    setForm(prev => ({
      ...prev,
      private: rws ? !!p.private : (rhttp?.settings?.visibility === "private"),
      maxPlayers: Number(p.maxPlayers ?? prev.maxPlayers),
      answerTimeSec: Number(p.answerTimeSec ?? prev.answerTimeSec),
      targetPoints: Number(p.targetPoints ?? prev.targetPoints),
      scoring: (p.scoring === "fixe" || p.pointMode === "fixed") ? "fixe" : "degressif",
      showProposals: !!(p.showProposals ?? prev.showProposals),
      categories: Array.isArray(p.categories) ? p.categories.map((x:any)=>Number(x)) : prev.categories,
      resultDelaySec: Number(p.resultDelaySec ?? prev.resultDelaySec),
      excludedUsernames: Array.isArray(p.excludedUsernames) ? p.excludedUsernames : prev.excludedUsernames,
    }));
  };

  useEffect(()=>{
    if (!code || code.length!==6) return;
    (async ()=>{
      try {
        const meRes = await api.get("/me");
        setMe(meRes.data.user);
        const myId = meRes.data.user.id;

        const r = await api.get(`/rooms/${code}`);
        setRoomHTTP(r.data.room);
        hydrateFormFromState(null, r.data.room);

        // catégories
        try {
          const cRes = await api.get("/categories/stats");
          const arr = Array.isArray(cRes.data?.categories) ? cRes.data.categories
                    : (Array.isArray(cRes.data) ? cRes.data : []);
          setCats(arr.map((c:any)=>({ id:Number(c.id), name:String(c.name), approvedCount: (c.questionCount ?? c.approvedCount ?? 0) })));
        } catch {/* ignore */}

        joinPayloadRef.current = { code, username: meRes.data.user.username, userId: myId, avatar: meRes.data.user.profileImage };

        const s = io(WS, { withCredentials:true, transports:['websocket','polling'], reconnection:true });
        setSocket(s);

        s.on("connect", () => {
          if (rejoinTimerRef.current) { clearTimeout(rejoinTimerRef.current); rejoinTimerRef.current = null; }
          s.emit("room:join", joinPayloadRef.current, (ack:any)=>{
            if (ack?.error === "banned") { window.location.href = "/lobby/"; }
          });
        });
        s.on("disconnect", () => {
          if (rejoinTimerRef.current) { clearTimeout(rejoinTimerRef.current); }
          rejoinTimerRef.current = setTimeout(() => { if (!s.connected) window.location.href = "/lobby/"; }, 3000);
        });

        s.on("room:kicked", ()=> { window.location.href = "/lobby/"; });
        s.on("room:banned", ()=> { window.location.href = "/lobby/"; });

        s.on("room:update", (payload:RoomWS)=>{
          setRoomWS(payload);
          hydrateFormFromState(payload, roomHTTP);
          if (payload?.status === 'running') { setErr(""); router.push(`/quiz/${codeRef.current}`); }
        });

        s.on("room:started", ()=> { setErr(""); router.push(`/quiz/${codeRef.current}`); });
        s.on("quiz:question",()=> { setErr(""); router.push(`/quiz/${codeRef.current}`); });

        setLoaded(true);
      } catch (e:any) {
        setErr(e?.response?.data?.error || e?.message || "Impossible de charger la salle");
        setLoaded(true);
      }
    })();
  },[code]);

  const players = roomWS?.players ?? roomHTTP?.members?.map(m=>({ userId:m.userId, username:m.username, avatar:m.profileImage||null, points:0, ready:false })) ?? [];
  const maxPlayers = roomWS?.params?.maxPlayers ?? roomHTTP?.settings?.maxPlayers ?? "?";
  const hostUserId = roomWS?.hostUserId ?? roomHTTP?.hostId ?? 0;

  const startQuiz = ()=>{
    if (!socket) return;
    setErr("");
    socket.emit("room:start", { code }, (ack:any)=>{
      if (ack?.ok) { router.push(`/quiz/${codeRef.current}`); }
      else if (ack?.error) { setErr(ack.error); }
    });
  };

  const transferHost = (userId:number)=>{
    if (!socket) return;
    setErr("");
    socket.emit("room:host:transfer", { code, userId }, (ack:any)=>{
      if (ack?.error) setErr(ack.error);
    });
  };

  const kick = (userId:number, ban:boolean)=>{
    if (!socket) return;
    setErr("");
    if (ban) socket.emit("room:ban", { code, userId }, (ack:any)=>{ if (ack?.error) setErr(ack.error); });
    else socket.emit("room:kick", { code, userId }, (ack:any)=>{ if (ack?.error) setErr(ack.error); });
  };

  const unban = (username:string)=>{
    if (!socket) return;
    socket.emit("room:unban", { code, username }, (ack:any)=>{
      if (ack?.ok && Array.isArray(ack.excludedUsernames)) {
        setForm(f=>({ ...f, excludedUsernames: ack.excludedUsernames }));
      }
    });
  };

  const leave = ()=>{
    const target = "/lobby/";
    if (!socket) { window.location.href = target; return; }
    try {
      socket.emit("room:leave", { code }, ()=>{
        try { socket.removeAllListeners(); } catch {}
        try { socket.disconnect(); } catch {}
        window.location.href = target;
      });
      setTimeout(()=>{ try { socket.removeAllListeners(); } catch {} try { socket.disconnect(); } catch {} window.location.href = target; }, 500);
    } catch {
      window.location.href = target;
    }
  };

  const saveParams = ()=>{
    if (!socket) return;
    setSaving(true); setSaved(null);

    // On N'ENVOIE PLUS les options retirées.
    // On force aussi des valeurs par défaut côté serveur pour celles-ci :
    // approvedOnly:true, preCountdownSec:0, types:[CITATION, IMAGE, TEXT]
    const params = {
      private: form.private,
      maxPlayers: form.maxPlayers,
      answerTimeSec: form.answerTimeSec,
      targetPoints: form.targetPoints,
      scoring: form.scoring,
      showProposals: form.showProposals,
      categories: form.categories,
      resultDelaySec: form.resultDelaySec,

      // force backend (non visibles dans l’UI)
      approvedOnly: true,
      preCountdownSec: 0,
      types: ['CITATION','IMAGE','TEXT'] as const,
    };

    socket.emit("room:config", { code, params }, (ack:any)=>{
      setSaving(false);
      if (ack?.ok) { setSaved("Paramètres enregistrés ✔"); setTimeout(()=>setSaved(null), 1500); }
      else if (ack?.error) { setErr(String(ack.error)); }
    });
  };

  if (!code || code.length!==6) return <main className="mx-auto max-w-3xl px-4 pt-8"><div className="card p-6">Code invalide.</div></main>;
  if (!loaded) return <main className="mx-auto max-w-3xl px-4 pt-8"><div className="card p-6">Chargement…</div></main>;
  const title = roomHTTP?.name || `Salle ${code}`;

  return (
    <main className="mx-auto max-w-5xl px-4 pt-8 space-y-6">
      {err && <div className="card p-3 border border-red-500/40 text-red-300">{err}</div>}

      <div className="card p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{title}</h1>
            <div className="text-white/70 text-sm">Code salle <span className="font-mono tracking-widest">{code}</span></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={leave}>Quitter</button>
            {isHost && (
              <>
                <button className="btn" onClick={()=>setShowParams(true)}>Paramètres</button>
                <button className="btn" onClick={startQuiz} title="Lancer la partie maintenant">
                  Démarrer la partie
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-3">Joueurs ({players.length}/{maxPlayers})</h2>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
          {players.map(m=>(
            <div key={m.userId} className="rounded-xl border border-white/10 p-3">
              <div className="flex items-center gap-3">
                <img src={avatarUrl(m.avatar || null)} className="h-10 w-10 rounded-full object-cover" alt="" />
                <div className="flex-1">
                  <div className="font-medium">{m.username}{hostUserId===m.userId && <Crown/>}</div>
                </div>
                {isHost && m.userId!==me?.id && (
                  <div className="flex gap-1">
                    <button className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20" onClick={()=>transferHost(m.userId)}>Donner la couronne</button>
                    <button className="text-xs px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30" onClick={()=>kick(m.userId,false)}>Exclure</button>
                    <button className="text-xs px-2 py-1 rounded bg-red-700/30 hover:bg-red-700/40" onClick={()=>kick(m.userId,true)}>Exclure & bannir</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal Paramètres */}
      {isHost && showParams && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-neutral-900 rounded-2xl border border-white/10 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Paramètres de la salle</h3>
              <button className="btn" onClick={()=>setShowParams(false)}>Fermer</button>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-medium mb-2">Salle</h4>
                <label className="block text-sm mb-1">Visibilité</label>
                <select className="input w-full mb-3"
                  value={form.private ? "private" : "public"}
                  onChange={e=>setForm(f=>({ ...f, private: e.target.value==="private" }))}
                >
                  <option value="public">Publique</option>
                  <option value="private">Privée</option>
                </select>

                <label className="block text-sm mb-1">Joueurs max</label>
                <input type="number" min={2} max={20} className="input w-full"
                  value={form.maxPlayers}
                  onChange={e=>setForm(f=>({...f, maxPlayers: Math.max(2, Math.min(20, Number(e.target.value)||10))}))}/>
              </div>

              <div>
                <h4 className="font-medium mb-2">Quiz</h4>
                <label className="block text-sm mb-1">Points à atteindre</label>
                <input type="number" min={10} max={1000} className="input w-full mb-3"
                  value={form.targetPoints}
                  onChange={e=>setForm(f=>({...f, targetPoints: Math.max(10, Math.min(1000, Number(e.target.value)||100))}))}/>

                <label className="block text-sm mb-1">Temps par question (secondes)</label>
                <input type="number" min={5} max={60} className="input w-full mb-3"
                  value={form.answerTimeSec}
                  onChange={e=>setForm(f=>({...f, answerTimeSec: Math.max(5, Math.min(60, Number(e.target.value)||15))}))}/>

                <label className="block text-sm mb-1">Mode de points</label>
                <select className="input w-full mb-3"
                  value={form.scoring}
                  onChange={e=>setForm(f=>({...f, scoring: e.target.value as any}))}
                >
                  <option value="degressif">Dégressif (10 → 1)</option>
                  <option value="fixe">Fixe (10)</option>
                </select>

                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.showProposals}
                    onChange={e=>setForm(f=>({...f, showProposals: e.target.checked}))}/>
                  Afficher les propositions (hors bonnes réponses)
                </label>
              </div>
            </div>

            <div className="mt-6 grid md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-medium mb-2">Questions</h4>

                {/* On a retiré Types autorisés & Approved-only */}
                <div className="mt-3">
                  <div className="text-sm text-white/70 mb-1">Catégories</div>
                  {cats.length ? (
                    <div className="grid sm:grid-cols-2 gap-2 max-h-40 overflow-auto p-2 rounded border border-white/10">
                      {cats.map(c=>(
                        <label key={c.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={form.categories.includes(c.id)}
                            onChange={e=>{
                              setForm(f=>{
                                const set = new Set(f.categories);
                                if (e.target.checked) set.add(c.id); else set.delete(c.id);
                                return {...f, categories: Array.from(set)};
                              });
                            }}
                          />
                          <span>{c.name}</span>
                          <span className="text-white/50 ml-auto">{(typeof c.approvedCount==="number"? c.approvedCount : "")}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-white/50">Impossible de charger les catégories (optionnel).</div>
                  )}
                  <div className="text-xs text-white/50 mt-1">Si aucune catégorie n’est cochée, toutes les catégories seront utilisées.</div>
                </div>
              </div>

              <div>
                <h4 className="font-medium mb-2">Temporisations</h4>

                {/* On a retiré Pré-décompte avant question */}
                <label className="block text-sm mb-1">Délai d’affichage de la correction (sec)</label>
                <input type="number" min={0} max={10} className="input w-full"
                  value={form.resultDelaySec}
                  onChange={e=>setForm(f=>({...f, resultDelaySec: Math.max(0, Math.min(10, Number(e.target.value)||5))}))}/>
              </div>
            </div>

            {/* Joueurs exclus */}
            <div className="mt-6">
              <h4 className="font-medium mb-2">Joueurs exclus</h4>
              {form.excludedUsernames?.length ? (
                <div className="flex flex-wrap gap-2">
                  {form.excludedUsernames.map(u=>(
                    <span key={u} className="inline-flex items-center gap-2 text-sm px-2 py-1 rounded bg-white/10">
                      {u}
                      <button className="text-xs text-red-300 hover:text-red-200" onClick={()=>unban(u)}>×</button>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-white/60">Aucun joueur banni.</div>
              )}
            </div>

            <div className="flex items-center justify-between mt-6">
              <div className="text-sm">{saved && <span className="text-emerald-400">{saved}</span>}</div>
              <button className="btn" disabled={saving} onClick={saveParams}>
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
