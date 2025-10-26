import { avatarUrl } from "../lib/media";
import { absoluteMediaUrl } from "../lib/media";
import Link from "next/link";
import { useEffect, useState } from "react";
import axios from "axios";

type User = { id:number; username:string; role:'user'|'admin'; profileImage?:string|null };

function computeApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_BASE) return process.env.NEXT_PUBLIC_API_BASE as string;
  if (typeof window !== "undefined") {
    const host = window.location.hostname;  // ex: niwot.btsinfo.nc
    const proto = window.location.protocol; // https:
    return `${proto}//api-game.${host}`;         // https://api-game.niwot.btsinfo.nc
  }
  return "";
}

export default function Header() {
  const [user, setUser] = useState<User|null>(null);
  const [loaded, setLoaded] = useState(false);
  const API = computeApiBase();

  useEffect(()=>{
    if (!API) return;
    axios.get(API+"/me", { withCredentials: true })
      .then(r=> setUser(r.data.user || null))
      .catch(()=> setUser(null))
      .finally(()=> setLoaded(true));
  },[API]);

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-black/40 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-4">
        <div className="flex items-center gap-6">
          <Link href="/lobby" className="text-xl font-bold text-[#a78bfa]">Niwot</Link>
          {loaded && user?.role === 'admin' && (
            <Link href="/administer" className="text-sm text-white/80 hover:text-white underline/30">Administration</Link>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {loaded && user ? (
            <>
              {user.profileImage
                ? <img src={avatarUrl(avatarUrl(avatarUrl(avatarUrl(avatarUrl(avatarUrl(avatarUrl(avatarUrl(avatarUrl(avatarUrl(avatarUrl(avatarUrl(avatarUrl(avatarUrl(avatarUrl(absoluteMediaUrl(user.profileImage) || "")))))))))))))))} alt="" className="h-8 w-8 rounded-full object-cover" />
                : <div className="h-8 w-8 rounded-full bg-white/10" />
              }
              <span className="text-sm text-white/70">Connecté en tant que <b>{user.username}</b></span>
              <Link href="/profile" className="btn text-sm">Mon profil</Link>
            </>
          ) : (
            <div className="h-8 w-24 rounded-xl bg-white/10" />  // skeleton léger
          )}
        </div>
      </div>
    </header>
  );
}
