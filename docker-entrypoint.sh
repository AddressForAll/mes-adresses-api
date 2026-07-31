#!/bin/sh
set -e

if [ "$LAUNCH_MIGRATION_AT_START" = "true" ]; then
  echo "Running TypeORM migrations..."
  yarn typeorm:migration:run
fi

# Honour an explicit command, so one-off tooling can share this image:
#   docker compose run --rm importer yarn overture:import --division ...
# With no command we start the API server exactly as before.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

exec node dist/apps/api/main.js
