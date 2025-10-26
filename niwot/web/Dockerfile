# Build stage
FROM node:20-bookworm-slim AS build
WORKDIR /app

# On accepte les build-args pour Next (ils seront inlinés au build)
ARG NEXT_PUBLIC_API_BASE
ARG NEXT_PUBLIC_WS_BASE
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_WS_BASE=$NEXT_PUBLIC_WS_BASE

COPY package.json ./
RUN npm install --no-audit --no-fund
COPY next.config.js tailwind.config.js postcss.config.js tsconfig.json ./
COPY src ./src
COPY public ./public
COPY .env.production ./
COPY .env.production ./
COPY .env.production ./
RUN npm run build

# Runtime
FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.js ./next.config.js
ENV PORT=3000
EXPOSE 3000
CMD ["npm","start","--","-p","3000"]
