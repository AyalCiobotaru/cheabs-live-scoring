import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ScanSummary } from '../../models';

@Component({
  selector: 'app-pool-sheet-panel',
  standalone: true,
  templateUrl: './pool-sheet-panel.component.html',
  styleUrl: './pool-sheet-panel.component.scss'
})
export class PoolSheetPanelComponent {
  @Input({ required: true }) isAdmin = false;
  @Input({ required: true }) imagePreview: string | null = null;
  @Input({ required: true }) scanStatus: 'idle' | 'scanning' | 'success' | 'failed' = 'idle';
  @Input() scanProgress = '';
  @Input() scanSummary: ScanSummary | null = null;
  @Input() scanError = '';

  @Output() sheetCaptured = new EventEmitter<Event>();
  @Output() sheetScanned = new EventEmitter<void>();
}
