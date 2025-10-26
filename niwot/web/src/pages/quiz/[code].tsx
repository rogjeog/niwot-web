import { useRouter } from "next/router";
import { useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { api } from "../../lib/api";
import { absoluteMediaUrl, avatarUrl } from "../../lib/media";

type RoomWS = {
  code: string;
  hostUserId: number;
  params: { answerTimeSec: number; targetPoints: number; showProposals: boolean; };
  players: Array<{ userId:number; username:string; avatar?:string|null; points:number; ready?:boolean }>;
  status: 'lobby'|'running'|'ended';
};

type QPayload = {
  serverNow: number;
  params: RoomWS["params"];
  question: { id: number; text: string; type: 'CITATION'|'IMAGE'|'TEXT'; citationText?: string|null; imagePath?: string|null; };
  startsAt: number; endsAt: number;
};

type ProposalsItem = { userId:number; username:string; avatar:string|null; points:number; guess:string };

const WS = (process.env.NEXT_PUBLIC_WS_BASE || "wss://api-game.niwot.btsinfo.nc") as string;

export default function QuizPage() {
  const router = useRouter();
  const code = String(router.query.code || "").toUpperCase();
  const codeRef = useRef(code); codeRef.current = code;

  const [socket, setSocket] = useState<Socket|null>(null);
  const [me, setMe] = useState<any>(null);

  const joinPayloadRef = useRef<any>(null);
  const rejoinTimerRef = useRef<any>(null);
  const [room, setRoom] = useState<RoomWS|null>(null);

  const [question, setQuestion] = useState<QPayload["question"]|null>(null);
  const [endsAt, setEndsAt] = useState<number|null>(null);
  const [serverDrift, setServerDrift] = useState(0);

  const [answer, setAnswer] = useState("");
  const [statusMsg, setStatusMsg] = useState<null | { kind:'ok'|'bad'; text:string }>(null);
  const [answeredCorrect, setAnsweredCorrect] = useState(false);

  const [proposals, setProposals] = useState<ProposalsItem[]>([]);
  const [result, setResult] = useState<null | { correct:string; first:string|null; explanation?:string|null }>(null);
  const [gameEnded, setGameEnded] = useState<null | { top?: Array<{username:string; points:number}>; reason?:string }>(null);

  const [now, setNow] = useState(Date.now());
  useEffect(()=>{ const t = setInterval(()=> setNow(Date.now()), 200); return ()=> clearInterval(t); },[]);

  const timeLeft = useMemo(()=>{
    if (!endsAt) return null;
    const clientNow = now + serverDrift;
    return Math.max(0, endsAt - clientNow);
  },[endsAt, now, serverDrift]);

  const isHost = useMemo(()=> (!!me && !!room && room.hostUserId === me.id), [me, room]);
  const hostName = useMemo(()=>{
    const u = room?.players?.find(p=>p.userId === room?.hostUserId);
    return u?.username || "—";
  }, [room]);

  useEffect(()=>{
    if (!code || code.length !== 6) return;
    (async ()=>{
      const meRes = await api.get("/me"); setMe(meRes.data.user);
      const myId = meRes.data.user.id;
      joinPayloadRef.current = { code, username: meRes.data.user.username, userId: myId, avatar: meRes.data.user.profileImage };

      const s = io(WS, { withCredentials:true, transports:["websocket","polling"], reconnection:true });
      setSocket(s);

      s.on("connect", ()=>{
        if (rejoinTimerRef.current) { clearTimeout(rejoinTimerRef.current); rejoinTimerRef.current = null; }
        s.emit("room:join", joinPayloadRef.current, (ack:any)=>{
          if (ack?.error === "banned") { window.location.href = "/lobby/"; return; }
        });
        s.emit("quiz:sync", { code }, ()=>{});
      });

      s.on("disconnect", ()=>{
        if (rejoinTimerRef.current) { clearTimeout(rejoinTimerRef.current); }
        rejoinTimerRef.current = setTimeout(()=>{ if (!s.connected) window.location.href = "/lobby/"; }, 3000);
      });

      s.on("room:kicked", ()=> { window.location.href = "/lobby/"; });
      s.on("room:banned", ()=> { window.location.href = "/lobby/"; });

      s.on("room:update", (payload:RoomWS)=> {
        setRoom(payload);
        if (!payload.players?.some(p => p.userId === myId)) { window.location.href = "/lobby/"; return; }
      });

      s.on("quiz:question", (payload:QPayload)=>{
        const clientNowAtReceive = Date.now();
        setServerDrift(payload.serverNow - clientNowAtReceive);

        setRoom(prev => prev ? { ...prev, params: payload.params } as RoomWS : prev);

        setResult(null); setProposals([]); setAnsweredCorrect(false); setStatusMsg(null); setAnswer("");
        setQuestion(payload.question); setEndsAt(payload.endsAt);
        setGameEnded(null);
      });

      s.on("quiz:proposals", (list:ProposalsItem[])=> setProposals(list || []));
      s.on("quiz:result", (r)=> setResult(r));
      s.on("quiz:ended", (p)=> setGameEnded(p || { reason: "Partie terminée" }));

      s.on("quiz:gotoRoom", ({ code: c, url }:{code:string; url?:string})=>{
        window.location.href = url || `/rooms/${c}`;
      });

      s.on("room:started", ()=>{
        setGameEnded(null);
        s.emit("quiz:sync", { code: codeRef.current });
      });

      setTimeout(()=>{ s.emit("quiz:sync", { code: codeRef.current }); }, 800);

      return ()=> { try { s.removeAllListeners(); } catch {} try { s.disconnect(); } catch {} };
    })();
  },[code]);

  const lastGuess = useMemo(()=>{
    const map = new Map<number, string>();
    for (const p of proposals) map.set(p.userId, p.guess);
    return map;
  },[proposals]);

  const submit = ()=>{
    if (!socket || !question || !code) return;
    if (answeredCorrect) return;
    const val = answer.trim();
    if (!val) return;
    setStatusMsg(null);
    socket.emit("quiz:answer", { code, answer: val }, (ack:any)=>{
      if (ack?.correct) { setAnsweredCorrect(true); setStatusMsg({ kind:'ok', text:"Trouvé !" }); }
      else { setStatusMsg({ kind:'bad', text:"Faux !" }); }
    });
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>)=>{ if (e.key === "Enter") submit(); };

  const quit = ()=>{
    const target = "/lobby/";
    if (!socket) { window.location.href = target; return; }
    try {
      socket.emit("room:leave", { code }, ()=> {
        try { socket.removeAllListeners(); } catch {}
        try { socket.disconnect(); } catch {}
        window.location.href = target;
      });
      setTimeout(()=>{ try { socket.removeAllListeners(); } catch {} try { socket.disconnect(); } catch {} window.location.href = target; }, 500);
    } catch {
      window.location.href = target;
    }
  };

  const restart = ()=>{
    if (!socket) return;
    socket.emit("quiz:restart", { code }, (ack:any)=>{
      if (!ack?.ok && ack?.error) { alert("Impossible de relancer: "+ack.error); }
    });
  };

  const gotoRoom = ()=>{
    if (!socket) return;
    socket.emit("quiz:gotoRoom", { code }, (ack:any)=>{
      if (ack?.ok && ack.url) { window.location.href = ack.url; }
      else if (ack?.ok) { window.location.href = `/rooms/${code}`; }
      else { alert("Redirection salle impossible."); }
    });
  };

  const inputDisabled = !!result || answeredCorrect || (timeLeft !== null && timeLeft <= 0);

  return (
    <main className="mx-auto max-w-6xl px-4 pt-6 space-y-6">
      <div className="card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button className="btn" onClick={quit}>Quitter le quiz</button>
            <div className="text-sm text-white/70">
              Salle <span className="font-mono">{code}</span>
              <span className="mx-2 text-white/40">•</span>
              Objectif : <span className="font-mono">{room?.params?.targetPoints ?? "?"} pts</span>
            </div>
          </div>
          <div className="text-sm text-white/70 flex items-center gap-3">
            <div>Hôte : <b>{hostName}</b></div>
            {question && timeLeft !== null
              ? <>Temps restant : <span className="font-mono">{Math.ceil(timeLeft/1000)}s</span></>
              : "En attente du quiz…"}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2">
          <div className="card p-6">
            {!question ? (
              <div className="text-center text-white/70">En attente de la première question…</div>
            ) : (
              <div className="space-y-5">
                <div className="text-center"><h1 className="text-2xl font-semibold">{question.text}</h1></div>

                <div className="flex justify-center min-h-[60px]">
                  {!result ? (
                    <>
                      {question.type === "CITATION" && question.citationText && (
                        <blockquote className="max-w-3xl italic text-white/90 text-center whitespace-pre-wrap break-words leading-relaxed">
                          “{question.citationText}”
                        </blockquote>
                      )}
                      {question.type === "IMAGE" && question.imagePath && (
                        <img src={absoluteMediaUrl(question.imagePath) || ""} alt="indice" className="max-h-[360px] rounded-xl border border-white/10"/>
                      )}
                    </>
                  ) : (
                    <div className="w-full max-w-2xl rounded-xl border border-white/10 p-4 bg-white/5 text-center">
                      <div className="text-emerald-400 font-medium">Bonne réponse : <span className="font-mono">{result.correct}</span></div>
                      <div className="text-white/80 text-sm mt-1">{result.first ? <>Premier trouvé : <b>{result.first}</b></> : "Personne n’a trouvé en premier"}</div>
                      {result.explanation && <div className="text-white/70 text-sm mt-2">{result.explanation}</div>}
                      <div className="text-white/50 text-xs mt-2">Nouvelle question dans 5 secondes…</div>
                    </div>
                  )}
                </div>

                <div className="max-w-xl mx-auto">
                  <label className="block text-sm mb-1 text-white/70">Votre réponse</label>
                  <div className="flex gap-2">
                    <input className="input flex-1" placeholder="Tapez votre réponse…" value={answer}
                      onChange={e=>setAnswer(e.target.value)} onKeyDown={onKey} disabled={inputDisabled}/>
                    <button className="btn" onClick={submit} disabled={inputDisabled}>Envoyer</button>
                  </div>
                  {statusMsg && <div className={`mt-2 text-sm ${statusMsg.kind==='ok' ? 'text-emerald-400' : 'text-red-400'}`}>{statusMsg.text}</div>}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="">
          <div className="card p-6">
            <h2 className="text-lg font-semibold mb-3">Joueurs</h2>
            <div className="space-y-3">
              { (room?.players || []).map(p=>(
                <div key={p.userId} className="flex items-center gap-3">
                  <img src={avatarUrl(p.avatar || null)} className="h-10 w-10 rounded-full object-cover" alt="" />
                  <div className="flex-1">
                    <div className="font-medium">
                      {p.username} <span className="text-white/50 font-normal">({p.points} pts)</span>
                      {p.userId === room?.hostUserId && <span className="ml-2 text-xs px-2 py-0.5 rounded bg-white/10">Hôte</span>}
                    </div>
                    <div className="text-xs text-white/70 break-all">
                      { (()=>{ const g = lastGuess.get(p.userId); return g ? <>Proposition : <span className="font-mono">{g}</span></> : <span className="text-white/40">Aucune proposition</span>; })() }
                    </div>
                  </div>
                </div>
              ))}
              {(room?.players?.length ?? 0) === 0 && <div className="text-white/60 text-sm">En attente des joueurs…</div>}
            </div>
          </div>
        </div>
      </div>

      {gameEnded && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-neutral-900 rounded-2xl border border-white/10 p-6 space-y-4">
            <h2 className="text-xl font-semibold text-center">Partie terminée</h2>
            {gameEnded.reason && <div className="text-white/70 text-center">{gameEnded.reason}</div>}
            {gameEnded.top?.length ? (
              <div className="space-y-2">
                <div className="text-white/70 text-sm text-center">Top joueurs</div>
                <div className="space-y-1">
                  {gameEnded.top.map((t,i)=>(
                    <div key={i} className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2">
                      <div className="text-white/90">{i+1}. {t.username}</div>
                      <div className="text-white/70">{t.points} pts</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-2 pt-2">
              {isHost && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <button className="btn flex-1" onClick={restart}>Relancer le quiz</button>
                  <button className="btn flex-1" onClick={gotoRoom}>Retourner à la salle</button>
                </div>
              )}
              <button className="btn" onClick={quit}>Quitter</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
