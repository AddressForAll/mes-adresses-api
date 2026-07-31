import { Module } from '@nestjs/common';

import { DuckDbClient } from './duckdb.client';
import { OvertureExtractService } from './overture-extract.service';
import { OvertureTransformService } from './overture-transform.service';

/**
 * Overture Maps import support.
 *
 * Lives in libs/shared rather than the importer app so the extract/transform
 * pair stays usable from any entrypoint, and so the pure transform can be
 * unit-tested without the importer's infrastructure.
 */
@Module({
  providers: [DuckDbClient, OvertureExtractService, OvertureTransformService],
  exports: [DuckDbClient, OvertureExtractService, OvertureTransformService],
})
export class OvertureModule {}
