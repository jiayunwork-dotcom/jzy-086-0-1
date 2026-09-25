# ---- 构建阶段 ----
FROM node:20-alpine AS build
WORKDIR /app

# 先拷依赖清单，利用层缓存
COPY package.json package-lock.json* ./
RUN npm ci

# 编译 TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# 剔除开发依赖
RUN npm prune --omit=dev

# ---- 运行阶段 ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

# 非 root 运行
USER node

COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node examples ./examples

EXPOSE 8080

# 容器级存活探针（需要 curl；alpine 自带 wget，这里用 node 原生 http）
HEALTHCHECK --interval=10s --timeout=3s --start-period=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
