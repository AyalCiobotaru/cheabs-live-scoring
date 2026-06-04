import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, signal } from '@angular/core';
import { PoolState, TeamStanding } from '../../models';

@Component({
  selector: 'app-pool-summary',
  standalone: true,
  templateUrl: './pool-summary.component.html',
  styleUrl: './pool-summary.component.scss'
})
export class PoolSummaryComponent implements OnInit, OnDestroy {
  @Input({ required: true }) pool!: PoolState;
  @Input({ required: true }) standings: TeamStanding[] = [];
  @Input({ required: true }) matchSummary = '';
  @Input({ required: true }) completedMatches = 0;
  @Input({ required: true }) totalMatches = 0;
  @Output() timerSelected = new EventEmitter<void>();

  readonly now = signal(Date.now());
  private tickInterval: number | null = null;

  ngOnInit(): void {
    this.tickInterval = window.setInterval(() => {
      this.now.set(Date.now());
    }, 1000);
  }

  ngOnDestroy(): void {
    if (this.tickInterval != null) {
      window.clearInterval(this.tickInterval);
    }
  }

  scoreFormatLabel(): string {
    return this.pool.pointCap == null ? 'No Cap' : `cap ${this.pool.pointCap}`;
  }

  timerStatus(): string {
    if (!this.pool.nextMatchStartAt) {
      return '';
    }

    const deadline = Date.parse(this.pool.nextMatchStartAt);

    if (!Number.isFinite(deadline)) {
      return '';
    }

    const remainingMs = deadline - this.now();

    if (remainingMs <= 0) {
      return 'Timer expired, Start Match';
    }

    return `Next match in ${this.formatRemaining(remainingMs)}`;
  }

  showTimerButton(): boolean {
    return this.pool.matchStartTimerMinutes > 0;
  }

  timerButtonClicked(event: Event): void {
    event.stopPropagation();
    this.timerSelected.emit();
  }

  private formatRemaining(remainingMs: number): string {
    const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}
