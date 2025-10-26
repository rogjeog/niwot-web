import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { avatarUrl } from "../lib/media";
import { io, Socket } from "socket.io-client";

const WS = (process.env.NEXT_PUBLIC_WS_BASE || "wss://api-game.niwot.btsinfo.nc") as string;

export default function ProfilePage() {
  const [me, setMe] = useState<any>(null);
  const [username, setUsername] = useState("");
  const [avatarFile, setAvatarFile] = useState<File|null>(null);

  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [newPwd2, setNewPwd2] = useState("");

  const [status, setStatus] = useState<{ kind:"ok"|"err"; text:string }|null>(null);
  const [loading, setLoading] = useState(false);

  const socketRef = useRef<Socket|null>(null);

  useEffect(()=>{
    (async ()=>{
      try {
        const r = await api.get("/me");
        setMe(r.data.user);
        setUsername(r.data.user.username || "");
        const s = io(WS, { withCredentials:true, transports:["websocket","polling"], reconnection:true });
        socketRef.current = s;
        s.emit("auth:hello", { userId: r.data.user.id });
      } catch (e:any) {
        setStatus({ kind:"err", text: e?.response?.data?.error || e?.message || "Impossible de récupérer le profil." });
      }
    })();
    return ()=> {
      try { socketRef.current?.removeAllListeners(); } catch {}
      try { socketRef.current?.disconnect(); } catch {}
    };
  },[]);

  function readFileAsDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject)=>{
      const fr = new FileReader();
      fr.onload = ()=> resolve(String(fr.result));
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  async function save() {
    if (!me) return;
    if (!socketRef.current) { setStatus({ kind:"err", text:"Socket non disponible." }); return; }
    if ((newPwd || newPwd2 || oldPwd) && newPwd !== newPwd2) {
      setStatus({ kind:"err", text:"Les nouveaux mots de passe ne correspondent pas." });
      return;
    }

    setLoading(true); setStatus(null);
    try {
      let avatarBase64: string | undefined;
      if (avatarFile) avatarBase64 = await readFileAsDataURL(avatarFile);

      await new Promise<void>((resolve, reject)=>{
        socketRef.current!.emit("profile:update", {
          username,
          oldPassword: oldPwd || undefined,
          newPassword: newPwd || undefined,
          confirmPassword: newPwd2 || undefined,
          avatarBase64
        }, (ack:any)=>{
          if (!ack?.ok) return reject(new Error(ack?.error || "update_failed"));
          resolve();
        });
      });

      const rr = await api.get("/me");
      setMe(rr.data.user);
      setAvatarFile(null);
      setOldPwd(""); setNewPwd(""); setNewPwd2("");
      setStatus({ kind:"ok", text:"Profil mis à jour." });
    } catch (e:any) {
      const msg = e?.message || e?.response?.data?.error || "Échec de la mise à jour.";
      let human = msg;
      if (msg === "bad_old_password") human = "Ancien mot de passe incorrect.";
      else if (msg === "password_mismatch") human = "Les nouveaux mots de passe ne correspondent pas.";
      else if (msg === "missing_password_fields") human = "Renseignez l'ancien, le nouveau et la confirmation.";
      else if (msg === "bad_image") human = "Image invalide.";
      setStatus({ kind:"err", text: human });
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    window.location.href = "/api/logout?next=/";
  }

  return (
    <main className="mx-auto max-w-3xl px-4 pt-8 space-y-6">
      <div className="card p-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold mb-1">Mon profil</h1>
          <div className="text-white/70 text-sm">Gérez votre avatar, votre pseudo et votre mot de passe.</div>
        </div>
        <button className="btn" onClick={logout} disabled={loading}>Déconnexion</button>
      </div>

      {status && (
        <div className={`card p-3 ${status.kind==="ok" ? "border border-emerald-600/40 text-emerald-300" : "border border-red-600/40 text-red-300"}`}>
          {status.text}
        </div>
      )}

      <div className="card p-6 space-y-6">
        <div className="flex items-center gap-4">
          <div>
            <img src={avatarUrl(avatarUrl(avatarUrl(avatarUrl(avatarUrl(avatarUrl(avatarUrl(me?.profileImage || null)))))))} className="h-20 w-20 rounded-full object-cover border border-white/10" alt="avatar"/>
          </div>
          <div className="flex-1">
            <div className="text-sm text-white/70 mb-1">Photo de profil</div>
            <input
              type="file"
              accept="image/*"
              onChange={(e)=> setAvatarFile(e.target.files?.[0] || null)}
              className="text-sm"
            />
            {avatarFile && <div className="text-xs text-white/50 mt-1">{avatarFile.name}</div>}
          </div>
        </div>

        <div>
          <label className="block text-sm text-white/70 mb-1">Nom d'utilisateur</label>
          <input
            className="input w-full"
            value={username}
            onChange={(e)=> setUsername(e.target.value)}
            placeholder="Votre pseudo"
          />
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-white/70 mb-1">Ancien mot de passe</label>
            <input className="input w-full" type="password" value={oldPwd} onChange={e=>setOldPwd(e.target.value)} placeholder="••••••••" />
          </div>
          <div>
            <label className="block text-sm text-white/70 mb-1">Nouveau mot de passe</label>
            <input className="input w-full" type="password" value={newPwd} onChange={e=>setNewPwd(e.target.value)} placeholder="••••••••" />
          </div>
          <div>
            <label className="block text-sm text-white/70 mb-1">Confirmer le nouveau</label>
            <input className="input w-full" type="password" value={newPwd2} onChange={e=>setNewPwd2(e.target.value)} placeholder="••••••••" />
          </div>
        </div>

        <div className="flex justify-end">
          <button className="btn" onClick={save} disabled={loading}>{loading ? "Enregistrement…" : "Enregistrer"}</button>
        </div>
      </div>
    </main>
  );
}
