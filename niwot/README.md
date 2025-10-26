# Niwot — Quiz temps réel façon JKLM

Stack:
- **Frontend**: Next.js + Tailwind (thème sombre/mauve galaxie)
- **API**: Node.js Express + Prisma + Socket.IO
- **DB**: MySQL 8 (Adminer exposé)
- **Reverse Proxy**: Nginx Proxy Manager (SQLite intégré, pas de BDD externe)
- **Domains**:
  - `https://niwot.btsinfo.nc` → frontend
  - `https://api-game.niwot.btsinfo.nc` → API + WebSocket
  - `https://adminer.niwot.btsinfo.nc` → Adminer

## Déploiement rapide

1. Installe Docker + plugin compose sur Debian 12
2. `docker compose up -d --build`
3. Exécute les migrations et la seed (depuis le conteneur API):
   ```bash
   docker compose exec api npx prisma db push
   docker compose exec api npm run seed
   ```

4. Configure Nginx Proxy Manager sur `http://<IP>:81` (ou via votre nom de domaine).
   - Identifiants initiaux: `admin@niwot.btsinfo.nc` / **(voir compose)**

## Comptes

- **Admin (appli)**: `admin` / `NiwotAdmin2025!` — modifiable ensuite via /profile
- **NPM Admin**: mail `admin@niwot.btsinfo.nc` / (variable `INITIAL_ADMIN_PASSWORD` dans compose)

## Sécurité
- Cookies httpOnly + Secure (sous-domaine `.niwot.btsinfo.nc`)
- Rate limit global 120 req/min
- Upload images profil/question max 2–3 Mo, formats: png/jpg/jpeg/webp
- MDP: 8+ car., 1 maj., 1 minuscule
- Rôles: `user` (défaut) / `admin`
