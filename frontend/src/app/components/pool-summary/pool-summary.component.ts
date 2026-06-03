import { Component, Input } from '@angular/core';
import { PoolState, TeamStanding } from '../../models';

@Component({
  selector: 'app-pool-summary',
  standalone: true,
  templateUrl: './pool-summary.component.html',
  styleUrl: './pool-summary.component.scss'
})
export class PoolSummaryComponent {
  @Input({ required: true }) pool!: PoolState;
  @Input({ required: true }) standings: TeamStanding[] = [];
  @Input({ required: true }) matchSummary = '';
  @Input({ required: true }) completedMatches = 0;
  @Input({ required: true }) totalMatches = 0;

  capLabel(): string {
    return this.pool.pointCap == null ? 'No Cap' : String(this.pool.pointCap);
  }
}
