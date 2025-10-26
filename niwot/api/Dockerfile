# Build stage (Bullseye = OpenSSL 1.1)
FROM node:20-bullseye-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate
RUN npm run build

# Runtime stage (Bullseye = OpenSSL 1.1)
FROM node:20-bullseye-slim
ENV NODE_ENV=production
WORKDIR /app

# tini + libssl1.1 pour Prisma
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini libssl1.1 \
 && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["/usr/bin/tini","--"]

COPY package.json ./

# On installe aussi les devDeps pour pouvoir exécuter prisma/tsx/tsc dans le conteneur
RUN npm install --no-audit --no-fund --include=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma

# (Re)génération prudente du client Prisma dans le runtime
RUN npx prisma generate

RUN mkdir -p /app/uploads
VOLUME ["/app/uploads"]
EXPOSE 4000
CMD ["node","dist/index.js"]
