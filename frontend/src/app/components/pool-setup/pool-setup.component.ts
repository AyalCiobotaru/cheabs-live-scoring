import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PoolState, ScanSummary } from '../../models';

@Component({
  selector: 'app-pool-setup',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './pool-setup.component.html'
})
export class PoolSetupComponent {
  @Input({ required: true }) pool!: PoolState;
  @Input({ required: true }) isAdmin = false;
  @Input({ required: true }) teamCountOptions: number[] = [];
  @Input({ required: true }) divisionOptions: string[] = [];
  @Input({ required: true }) scanStatus: 'idle' | 'scanning' | 'success' | 'failed' = 'idle';
  @Input() scanProgress = '';
  @Input() scanSummary: ScanSummary | null = null;
  @Input() scanError = '';

  @Output() sheetCaptured = new EventEmitter<Event>();
  @Output() sheetScanned = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();
  @Output() teamCountChanged = new EventEmitter<number>();
  @Output() gameFormatApplied = new EventEmitter<void>();
  @Output() poolSetupSaved = new EventEmitter<void>();
  @Output() setupCanceled = new EventEmitter<void>();
  @Output() matchAdded = new EventEmitter<void>();
  @Output() matchRemoved = new EventEmitter<string>();
}
