import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { PlayoffConfiguration } from '../../models';
import { ScoringEventStateService } from '../../service/scoring-event-state.service';

@Component({
  selector: 'app-playoffs-page',
  standalone: true,
  templateUrl: './playoffs-page.component.html'
})
export class PlayoffsPageComponent {
  readonly scoring = inject(ScoringEventStateService);
  private readonly route = inject(ActivatedRoute);

  get playoffs(): PlayoffConfiguration[] {
    this.scoring.version();
    const category = this.route.snapshot.queryParamMap.get('category');
    const division = this.route.snapshot.queryParamMap.get('division');
    return (
      this.scoring.event?.playoffs.filter(
        (playoff) => (!category || playoff.category === category) && (!division || playoff.division === division)
      ) ?? []
    );
  }
}
