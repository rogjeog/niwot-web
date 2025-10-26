import { useEffect, useState } from "react";
import axios from "axios";

function computeApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_BASE) return process.env.NEXT_PUBLIC_API_BASE as string;
  if (typeof window !== "undefined") {
    const host = window.location.hostname;  // ex: niwot.btsinfo.nc
    const proto = window.location.protocol; // https:
    return `${proto}//api-game.${host}`;         // https://api-game.niwot.btsinfo.nc
  }
  return "";
}

type Category = { id:number; name:string; slug?:string };

export default function Suggest() {
  const API = computeApiBase();

  // Form state
  const [text, setText] = useState("");
  const [qType, setQType] = useState<"CITATION"|"IMAGE">("CITATION");
  const [quote, setQuote] = useState("");
  const [image, setImage] = useState<File|null>(null);
  const [answer, setAnswer] = useState("");
  const [alternativesRaw, setAlternativesRaw] = useState(""); // 1 alt / ligne ou CSV
  const [explanation, setExplanation] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string>("");
  const [err, setErr] = useState<string>("");

  // Charge les catégories publiques
  useEffect(()=>{
    if (!API) return;
    setLoading(true);
    axios.get(API + "/categories")
      .then(r => setCategories(r.data.categories || r.data || []))
      .catch(()=> setCategories([]))
      .finally(()=> setLoading(false));
  },[API]);

  const toggleCat = (id:number)=>{
    setSelected(prev=>{
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const normalizeAlts = (raw:string): string[]=>{
    // Permet "ALT1,ALT2" ou lignes multiples
    return raw
      .split(/[\n,]+/).map(s=>s.trim()).filter(Boolean);
  };

  const onSubmit = async (e:any)=>{
    e.preventDefault();
    setMsg(""); setErr("");

    // Vérifs
    if (!text.trim()) return setErr("La question est obligatoire.");
    if (qType === "CITATION" && !quote.trim()) return setErr("La citation est obligatoire.");
    if (qType === "IMAGE" && !image) return setErr("L'image est obligatoire.");
    if (!answer.trim()) return setErr("La réponse est obligatoire.");
    if (selected.size === 0) return setErr("Choisissez au moins une catégorie.");

    // Prépare la payload (multipart)
    const fd = new FormData();
    fd.append("text", text.trim());
    fd.append("type", qType);
    if (qType === "CITATION") { fd.append("citationText", quote.trim()); fd.append("quote", quote.trim()); }
    if (qType === "IMAGE" && image) fd.append("image", image);
    fd.append("answer", answer.trim());
    const alts = normalizeAlts(alternativesRaw);
    if (alts.length) fd.append("alternatives", JSON.stringify(alts));
    fd.append("explanation", explanation.trim());
    fd.append("categoryIds", JSON.stringify(Array.from(selected)));

    try {
      await axios.post(API + "/suggest", fd, {
        withCredentials: true,
        headers: { "Content-Type": "multipart/form-data" }
      });
      setMsg("Proposition envoyée ! Elle sera visible après validation.");
      // reset léger (on garde les catégories sélectionnées)
      setText("");
      setQuote("");
      setImage(null);
      setAnswer("");
      setAlternativesRaw("");
      setExplanation("");
    } catch (e:any) {
      setErr(e?.response?.data?.error || e?.message || "Erreur lors de l'envoi.");
    }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 pt-8">
        <div className="card p-6">Chargement…</div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 pt-8">
      <div className="card p-6 space-y-6">
        <h1 className="text-xl font-semibold">Proposer une question</h1>

        <form onSubmit={onSubmit} className="space-y-6">
          {/* Question */}
          <div>
            <div className="label">Question *</div>
            <input className="input" value={text} onChange={e=>setText(e.target.value)} placeholder="Ex. De quel film est tirée cette réplique ?" />
          </div>

          {/* Type */}
          <div>
            <div className="label">Type de question *</div>
            <div className="flex gap-3">
              <label className="flex items-center gap-2">
                <input type="radio" name="qtype" checked={qType==='CITATION'} onChange={()=>setQType('CITATION')} />
                <span>Citation</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="qtype" checked={qType==='IMAGE'} onChange={()=>setQType('IMAGE')} />
                <span>Image</span>
              </label>
            </div>
          </div>

          {/* Contenu selon type */}
          {qType === "CITATION" ? (
            <div>
              <div className="label">Texte de la citation *</div>
              <textarea className="input min-h-[100px]" value={quote} onChange={e=>setQuote(e.target.value)} />
            </div>
          ) : (
            <div>
              <div className="label">Image *</div>
              <input type="file" accept="image/*" onChange={e=>setImage(e.target.files?.[0]||null)} />
            </div>
          )}

          {/* Réponse + alternatives */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="label">Réponse *</div>
              <input className="input" value={answer} onChange={e=>setAnswer(e.target.value)} placeholder="Réponse attendue" />
              <p className="text-xs text-white/60 mt-1">Stockée en MAJUSCULES sans espace ni accent côté serveur.</p>
            </div>
            <div>
              <div className="label">Alternatives (facultatif)</div>
              <textarea className="input min-h-[80px]" value={alternativesRaw} onChange={e=>setAlternativesRaw(e.target.value)} placeholder="Une par ligne ou séparées par des virgules" />
              <p className="text-xs text-white/60 mt-1">Elles seront normalisées comme la réponse.</p>
            </div>
          </div>

          {/* Explication */}
          <div>
            <div className="label">Explication *</div>
            <textarea className="input min-h-[100px]" value={explanation} onChange={e=>setExplanation(e.target.value)} />
          </div>

          {/* Catégories */}
          <div>
            <div className="label">Catégories * (au moins une)</div>
            {categories.length === 0 ? (
              <div className="text-white/60 text-sm">Aucune catégorie disponible.</div>
            ) : (
              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2">
                {categories.map(c=>(
                  <label key={c.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={()=>toggleCat(c.id)}
                    />
                    <span>{c.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Messages */}
          {err && <div className="text-red-400 text-sm break-words">{err}</div>}
          {msg && <div className="text-emerald-400 text-sm">{msg}</div>}

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button className="btn">Envoyer</button>
          </div>
        </form>
      </div>
    </main>
  );
}
