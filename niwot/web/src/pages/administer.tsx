import { avatarUrl } from "../lib/media";
import { useEffect, useState } from "react";
import axios from "axios";

function computeApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_BASE) return process.env.NEXT_PUBLIC_API_BASE as string;
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    const proto = window.location.protocol;
    return `${proto}//api-game.${host}`;
  }
  return "";
}

type User = { id:number; username:string; role:'user'|'admin'; wins:number; profileImage?:string|null; createdAt?:string; };
type Question = { id:number; text:string; status:'awaiting_approval'|'approved'|'refused'; type:'CITATION'|'IMAGE'; createdBy:{username:string} };
type Category = { id:number; name:string; slug?:string; questionCount:number; createdAt?:string|null };

export default function Administer() {
  const API = computeApiBase();
  const [loaded, setLoaded] = useState(false);
  const [me, setMe] = useState<User|null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [err, setErr] = useState<string>('');

  const [newCatName, setNewCatName] = useState('');
  const [editingId, setEditingId] = useState<number|null>(null);
  const [editingName, setEditingName] = useState<string>('');

  const refresh = async ()=>{
    setErr('');
    try{
      const meRes = await axios.get(API+'/me', { withCredentials:true });
      setMe(meRes.data.user||null);
      if (meRes.data.user?.role !== 'admin') {
        if (typeof window !== 'undefined') window.location.href='/lobby';
        return;
      }
      const [u,q,c] = await Promise.all([
        axios.get(API+'/admin/users', { withCredentials:true }),
        axios.get(API+'/admin/questions', { withCredentials:true }),
        axios.get(API+'/admin/categories', { withCredentials:true }),
      ]);
      setUsers(u.data.users||[]);
      setQuestions(q.data.questions||[]);
      setCategories(c.data.categories||[]);
    }catch(e:any){
      setErr(e?.response?.data?.error || e?.message || 'Erreur');
    }finally{
      setLoaded(true);
    }
  };

  useEffect(()=>{ if (API) refresh(); },[API]);

  // Questions
  const setStatus = async (id:number, status:Question['status'])=>{
    try{
      await axios.patch(API+'/admin/questions/'+id, { status }, { withCredentials:true });
      refresh();
    }catch(e:any){ alert(e?.response?.data?.error || e?.message); }
  };
  const delQuestion = async (id:number)=>{
    if (!confirm('Supprimer la question ?')) return;
    try{
      await axios.delete(API+'/admin/questions/'+id, { withCredentials:true });
      refresh();
    }catch(e:any){ alert(e?.response?.data?.error || e?.message); }
  };

  // Catégories
  const addCategory = async (e:any)=>{
    e.preventDefault();
    if (!newCatName.trim()) return;
    try{
      await axios.post(API+'/admin/categories', { name: newCatName.trim() }, { withCredentials:true });
      setNewCatName(''); refresh();
    }catch(e:any){ alert(e?.response?.data?.error || e?.message); }
  };
  const startEdit = (cat: Category)=>{ setEditingId(cat.id); setEditingName(cat.name); };
  const cancelEdit = ()=>{ setEditingId(null); setEditingName(''); };
  const saveEdit = async ()=>{
    if (editingId == null) return;
    try{
      await axios.put(API+'/admin/categories/'+editingId, { name: editingName }, { withCredentials:true });
      setEditingId(null); setEditingName(''); refresh();
    }catch(e:any){ alert(e?.response?.data?.error || e?.message); }
  };
  const deleteCategory = async (id:number, count:number)=>{
    if (count>0 && !confirm(`Cette catégorie a ${count} question(s). Supprimer quand même ?`)) return;
    try{
      await axios.delete(API+'/admin/categories/'+id, { withCredentials:true });
      refresh();
    }catch(e:any){ alert(e?.response?.data?.error || e?.message); }
  };

  if (!loaded) return (<main className="mx-auto max-w-6xl px-4 pt-8"><div className="card p-6">Chargement…</div></main>);
  if (!me) return null;

  return (
    <main className="mx-auto max-w-6xl px-4 pt-8 space-y-8">
      {/* Utilisateurs */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-3">Utilisateurs ({users.length})</h2>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="text-white/70">
              <tr>
                <th className="text-left p-2">ID</th>
                <th className="text-left p-2">Avatar</th>
                <th className="text-left p-2">Username</th>
                <th className="text-left p-2">Role</th>
                <th className="text-left p-2">Wins</th>
                <th className="text-left p-2">Créé</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u=>(
                <tr key={u.id} className="border-t border-white/10">
                  <td className="p-2">{u.id}</td>
                  <td className="p-2">{u.profileImage ? <img src={avatarUrl(avatarUrl(avatarUrl(avatarUrl(avatarUrl(avatarUrl(u.profileImage))))))} className="h-8 w-8 rounded-full" /> : '-'}</td>
                  <td className="p-2">{u.username}</td>
                  <td className="p-2">{u.role}</td>
                  <td className="p-2">{u.wins}</td>
                  <td className="p-2">{u.createdAt ? new Date(u.createdAt).toLocaleString() : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {users.length===0 && <div className="text-white/60 mt-3">Aucun utilisateur à afficher.</div>}
      </div>

      {/* Catégories */}
      <div className="card p-6 space-y-4">
        <h2 className="text-lg font-semibold">Catégories ({categories.length})</h2>
        <form onSubmit={addCategory} className="flex gap-2">
          <input className="input flex-1" placeholder="Nom de la catégorie…" value={newCatName} onChange={e=>setNewCatName(e.target.value)} />
          <button className="btn">Ajouter</button>
        </form>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="text-white/70">
              <tr>
                <th className="text-left p-2">ID</th>
                <th className="text-left p-2">Nom</th>
                <th className="text-left p-2">Slug</th>
                <th className="text-left p-2"># Questions</th>
                <th className="text-left p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map(c=>(
                <tr key={c.id} className="border-t border-white/10">
                  <td className="p-2">{c.id}</td>
                  <td className="p-2">
                    {editingId===c.id ? (
                      <input className="input" value={editingName} onChange={e=>setEditingName(e.target.value)} />
                    ) : c.name}
                  </td>
                  <td className="p-2">{c.slug || '-'}</td>
                  <td className="p-2">{c.questionCount}</td>
                  <td className="p-2 flex gap-2">
                    {editingId===c.id ? (
                      <>
                        <button className="btn" onClick={saveEdit} type="button">Enregistrer</button>
                        <button className="btn opacity-70" onClick={cancelEdit} type="button">Annuler</button>
                      </>
                    ) : (
                      <>
                        <button className="btn" onClick={()=>startEdit(c)} type="button">Renommer</button>
                        <button className="btn opacity-70" onClick={()=>deleteCategory(c.id, c.questionCount)} type="button">Supprimer</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {categories.length===0 && <div className="text-white/60 mt-3">Aucune catégorie.</div>}
      </div>

      {/* Questions */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-3">Questions proposées ({questions.length})</h2>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="text-white/70">
              <tr>
                <th className="text-left p-2">ID</th>
                <th className="text-left p-2">Texte</th>
                <th className="text-left p-2">Type</th>
                <th className="text-left p-2">Statut</th>
                <th className="text-left p-2">Auteur</th>
                <th className="text-left p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {questions.map(q=>(
                <tr key={q.id} className="border-t border-white/10">
                  <td className="p-2">{q.id}</td>
                  <td className="p-2">{q.text}</td>
                  <td className="p-2">{q.type}</td>
                  <td className="p-2">{q.status}</td>
                  <td className="p-2">{q.createdBy?.username}</td>
                  <td className="p-2 flex gap-2">
                    <button className="btn" onClick={()=>setStatus(q.id, 'approved')}>Approuver</button>
                    <button className="btn" onClick={()=>setStatus(q.id, 'awaiting_approval')}>En attente</button>
                    <button className="btn" onClick={()=>setStatus(q.id, 'refused')}>Refuser</button>
                    <button className="btn opacity-70" onClick={()=>delQuestion(q.id)}>Supprimer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {questions.length===0 && <div className="text-white/60 mt-3">Aucune question à afficher.</div>}
      </div>

      {err && <div className="text-red-400 text-sm break-words">{err}</div>}
    </main>
  );
}
