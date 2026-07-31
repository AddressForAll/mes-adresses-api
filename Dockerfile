# syntax=docker/dockerfile:1

FROM node:24-bookworm AS builder
WORKDIR /app

# Build deps for the native modules `canvas` and `sharp`.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ pkg-config \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev libpixman-1-dev \
    && rm -rf /var/lib/apt/lists/*

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .
RUN yarn build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Runtime libs matching the builder's `canvas`/`sharp` native deps.
# `ca-certificates` is needed by the Overture importer: DuckDB's httpfs makes
# its own TLS calls to the public S3 bucket and fails with "Problem with the
# SSL CA cert" without the system trust store (node's is bundled, DuckDB's is not).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 \
    && rm -rf /var/lib/apt/lists/*

# Keep the repo layout: `dist/apps/api/...`, root JSON data files, `public/`, and
# `email-templates/` are all resolved via relative paths from the compiled output.
COPY --from=builder /app /app

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 5000
ENTRYPOINT ["docker-entrypoint.sh"]
