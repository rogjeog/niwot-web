import { avatarUrl } from "../lib/media";
import { useEffect, useState } from "react";
import axios from "axios";
import { useRouter } from "next/router";

function computeApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_BASE) return process.env.NEXT_PUBLIC_API_BASE as string;
  if (typeof window !== "undefined") {
    const host = window.location.hostname;               // ex: niwot.btsinfo.nc
    const proto = window.location.protocol;              // https:
    return `${proto}//api-game.${host}`;                      // => https://api-game.niwot.btsinfo.nc
  }
  return "";
}

export default function Home() {
  const API = computeApiBase();
  const router = useRouter();
  const [tab, setTab] = useState<'login'|'register'>('login');
  const [login, setLogin] = useState({ username:'', password:'' });
  const [reg, setReg] = useState({ username:'', password:'', password2:'' });
  const [avatar, setAvatar] = useState<File|null>(null);
  const [error, setError] = useState<string>('');
  const [loaded, setLoaded] = useState(false);

  useEffect(()=>{
    if (!API) return;
    axios.get(API+'/me', { withCredentials: true })
      .then(r=> { if (r.data?.user) router.replace('/lobby'); })
      .finally(()=> setLoaded(true));
  },[API]);

  const doLogin = async (e:any)=>{
    e.preventDefault();
    setError('');
    try {
      await axios.post(API+'/auth/login', login, { withCredentials:true });
      router.push('/lobby');
    } catch (e:any) {
      const msg = e?.response?.data?.error || e?.message || 'Erreur';
      setError(msg);
    }
  };

  const doRegister = async (e:any)=>{
    e.preventDefault();
    setError('');
    try {
      const fd = new FormData();
      fd.append('username', reg.username);
      fd.append('password', reg.password);
      fd.append('password2', reg.password2);
      if (avatar) fd.append('avatar', avatar);
      await axios.post(API+'/auth/register', fd, { withCredentials:true });
      router.push('/lobby');
    } catch (e:any) {
      const msg = e?.response?.data?.error || e?.message || 'Erreur';
      setError(msg);
    }
  };

  if (!loaded) return null;

  return (
    <main className="mx-auto max-w-md px-4 pt-16">
      <div className="card p-6">
        <h1 className="text-2xl font-bold mb-4 text-center">Bienvenue sur <span className="text-niwot-accent">Niwot</span></h1>

        <div className="flex mb-6 gap-2">
          <button onClick={()=>setTab('login')} className={"flex-1 btn " + (tab==='login'?'':'opacity-60')}>Connexion</button>
          <button onClick={()=>setTab('register')} className={"flex-1 btn " + (tab==='register'?'':'opacity-60')}>Créer un compte</button>
        </div>

        {tab==='login' && (
          <form onSubmit={doLogin} className="space-y-3">
            <div>
              <div className="label">Nom d&apos;utilisateur</div>
              <input className="input" value={login.username} onChange={e=>setLogin({...login, username:e.target.value})} />
            </div>
            <div>
              <div className="label">Mot de passe</div>
              <input type="password" className="input" value={login.password} onChange={e=>setLogin({...login, password:e.target.value})} />
            </div>
            {error && <div className="text-red-400 text-sm break-words">{error}</div>}
            <button className="btn w-full">Se connecter</button>
          </form>
        )}

        {tab==='register' && (
          <form onSubmit={doRegister} className="space-y-3">
            <div>
              <div className="label">Photo de profil</div>
              <input type="file" accept="image/*" onChange={e=>setAvatar(e.target.files?.[0]||null)} />
            </div>
            <div>
              <div className="label">Nom d&apos;utilisateur (unique)</div>
              <input className="input" value={reg.username} onChange={e=>setReg({...reg, username:e.target.value})} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="label">Mot de passe</div>
                <input type="password" className="input" value={reg.password} onChange={e=>setReg({...reg, password:e.target.value})} />
                <p className="text-xs text-white/60 mt-1">8+ caractères, 1 majuscule, 1 minuscule</p>
              </div>
              <div>
                <div className="label">Confirmer le mot de passe</div>
                <input type="password" className="input" value={reg.password2} onChange={e=>setReg({...reg, password2:e.target.value})} />
              </div>
            </div>
            {error && <div className="text-red-400 text-sm break-words">{error}</div>}
            <button className="btn w-full">Créer mon compte</button>
          </form>
        )}
      </div>
    </main>
  );
}
