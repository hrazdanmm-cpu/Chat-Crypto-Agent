# ============================================================================
#  Chat Crypto — Dockerfile (Fly.io deploy-ի համար)
# ============================================================================
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.js bot.js ./

# public/ ֆայլերը ինքն է ստեղծում server.js-ը startup-ի ժամանակ (embedded
# fallback), ուստի Dockerfile-ում copy անելու կարիք չկա, բայց եթե
# public/ folder-ը գոյություն ունի local-ում, ավելի լավ է copy անել այն էլ։
COPY public ./public

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
