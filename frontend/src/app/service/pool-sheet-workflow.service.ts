import { Injectable } from '@angular/core';
import { PoolState, ScanSummary, SheetScanResult } from '../models';
import { uniquePoolTitle } from '../util/pool-draft-rules';
import { readPoolSheetImage } from '../util/pool-sheet-image';
import { formatScanProgress, touchPool } from '../util/pool-runtime-rules';
import { applySheetScanToPool, buildScanSummary } from './sheet-scan-mapper';
import { SheetScannerService } from './sheet-scanner.service';

@Injectable({ providedIn: 'root' })
export class PoolSheetWorkflowService {
  constructor(private readonly scanner: SheetScannerService) {}

  imagePreview(file: File): Promise<string> {
    return readPoolSheetImage(file);
  }

  scan(
    imagePreview: string,
    adminPassword: string,
    onProgress: (message: string) => void
  ): Promise<SheetScanResult> {
    return this.scanner.scan(
      imagePreview,
      (progress) => onProgress(formatScanProgress(progress.status, progress.progress)),
      adminPassword
    );
  }

  applyScan(pool: PoolState, scan: SheetScanResult, pools: PoolState[]): ScanSummary {
    Object.assign(
      pool,
      applySheetScanToPool(pool, scan, uniquePoolTitle(pools, scan.title?.trim() || pool.title, pool.id))
    );
    touchPool(pool);
    return buildScanSummary(pool, scan);
  }
}
