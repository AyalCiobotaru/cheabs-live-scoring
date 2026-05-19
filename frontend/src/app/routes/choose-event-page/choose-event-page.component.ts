import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ScoringEventStateService } from '../../service/scoring-event-state.service';

@Component({
  selector: 'app-choose-event-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './choose-event-page.component.html'
})
export class ChooseEventPageComponent {
  readonly scoring = inject(ScoringEventStateService);
}
