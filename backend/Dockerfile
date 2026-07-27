# ---------- 构建阶段：安装依赖并编译 TypeScript ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm ci --omit=dev

# ---------- 运行阶段：仅生产依赖 + 编译产物 ----------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
EXPOSE 4000
VOLUME ["/app/uploads"]
CMD ["node", "dist/index.js"]
