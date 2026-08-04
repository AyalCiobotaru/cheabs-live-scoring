import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { PoolState, SeededImportPreview } from '../../models';

@Component({
  selector: 'app-seeded-import-preview',
  standalone: true,
  templateUrl: './seeded-import-preview.component.html',
  styleUrl: './seeded-import-preview.component.scss'
})
export class SeededImportPreviewComponent {
  @Input({ required: true }) preview: SeededImportPreview | null = null;

  @Output() timerSelected = new EventEmitter<string>();

  activeTooltipId = '';

  toggleTooltip(event: Event, tooltipId: string): void {
    event.stopPropagation();
    this.activeTooltipId = this.activeTooltipId === tooltipId ? '' : tooltipId;
  }

  @HostListener('document:click')
  closeTooltip(): void {
    this.activeTooltipId = '';
  }

  seededPoolSummary(pool: PoolState): string {
    return `${pool.teamCount} teams, ${pool.gamesPerMatch} game${pool.gamesPerMatch === 1 ? '' : 's'} to ${
      pool.targetScore
    }, ${pool.pointCap === null ? 'no cap' : `cap ${pool.pointCap}`}, ${this.seededTimerSummary(
      pool
    )}, ${this.courtSummary(pool)}, ${pool.editable ? 'scoring open' : 'scoring locked'}, ${
      pool.hidden ? 'hidden' : 'visible'
    }`;
  }

  private seededTimerSummary(pool: PoolState): string {
    return pool.matchStartTimerMinutes > 0 ? `${pool.matchStartTimerMinutes} min between matches` : 'match timer off';
  }

  private courtSummary(pool: PoolState): string {
    const courtNumbers = pool.courtNumbers ?? [];

    return courtNumbers.length
      ? `court${courtNumbers.length === 1 ? '' : 's'} ${courtNumbers.join(', ')}`
      : 'no courts';
  }
}
