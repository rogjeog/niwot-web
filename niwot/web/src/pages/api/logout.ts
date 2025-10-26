import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const next = (req.query.next as string) || "/";

  // Parse dynamiquement tous les cookies présents
  const raw = req.headers.cookie || "";
  const names = Array.from(new Set(
    raw.split(/;\s*/).map(s => s.split("=")[0]).filter(Boolean)
  ));

  const expires = "Thu, 01 Jan 1970 00:00:00 GMT";
  const common = `Path=/; HttpOnly; Secure; Expires=${expires}`;

  // On purge pour 2 domaines pour couvrir tous les cas
  const domains = ["; Domain=.niwot.btsinfo.nc", "; Domain=niwot.btsinfo.nc", ""];

  const setCookies: string[] = [];
  for (const n of names) {
    for (const d of domains) {
      // Set-Cookie sans SameSite (par défaut) et avec SameSite=Lax & None pour maximiser l'effacement
      setCookies.push(`${n}=; ${common}${d}; SameSite=Lax`);
      setCookies.push(`${n}=; ${common}${d}; SameSite=None`);
    }
  }

  if (setCookies.length) res.setHeader("Set-Cookie", setCookies);

  // Redirection finale
  res.writeHead(302, { Location: next });
  res.end();
}
