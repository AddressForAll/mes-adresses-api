#!/bin/sh
set -e

if [ "$LAUNCH_MIGRATION_AT_START" = "true" ]; then
  echo "Running TypeORM migrations..."
  yarn typeorm:migration:run
fi

exec node dist/apps/api/main.js
