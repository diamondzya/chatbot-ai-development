# STI Assist AI — container image
#
# Build (run the indexer first so data/index.json exists):
#   npm ci && npm run index
#   docker build -t sti-assist .
#
# Run:
#   docker run --rm -p 3000:3000 --env-file .env sti-assist
#
# The image expects data/index.json and data/models/ (the local embedding
# cache, if EMBEDDING_PROVIDER=local) to be present in the build context.

FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts
COPY public ./public
COPY data ./data

# The handbook PDF is only needed at runtime when SERVE_HANDBOOK_PDF=true.
# Copy it if the deployment is allowed to redistribute the document:
# COPY ["STI High School Student Handbook 2026 (ORCA).pdf", "./"]

EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
