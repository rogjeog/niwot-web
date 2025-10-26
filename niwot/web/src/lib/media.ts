export function absoluteMediaUrl(u?: string | null): string | null {
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  const base = process.env.NEXT_PUBLIC_UPLOADS_BASE || "https://api-game.niwot.btsinfo.nc";
  return `${base}${u.startsWith("/") ? "" : "/"}${u}`;
}
export function avatarUrl(u?: string | null): string {
  if (u && String(u).trim()) {
    const abs = absoluteMediaUrl(u);
    if (abs) return abs;
  }
  // Fallback ABSOLU sur le front
  return "https://niwot.btsinfo.nc/niwotfren.png";
}
