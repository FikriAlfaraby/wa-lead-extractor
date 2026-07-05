# Demo container: static UI + live pipeline API (same code as the CF Worker).
# Run with: docker run -d -p 8788:8080 \
#   -e LLM_API_KEY=... -e LLM_BASE_URL=... -e LLM_MODEL=... wa-lead-extractor
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY ui/package.json ui/package-lock.json ui/
RUN cd ui && npm ci

COPY . .
RUN cd ui && npm run build

ENV NODE_ENV=production
EXPOSE 8080
CMD ["npx", "tsx", "server/node.ts"]
