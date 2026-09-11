# ---------- 构建前端 ----------
FROM node:22-alpine AS builder
WORKDIR /app/web
COPY web/package*.json ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---------- 运行 ----------
FROM node:22-alpine
WORKDIR /app

# 后端零依赖（数据库用 Node 内置 node:sqlite），只需拷源码
COPY server/ ./server/
COPY package.json ./
COPY --from=builder /app/web/dist ./web/dist

# 数据目录（挂卷持久化）
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1

CMD ["node", "server/index.js"]
