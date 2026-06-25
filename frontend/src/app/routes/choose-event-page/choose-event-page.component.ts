import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ScoringEventStateService } from '../../service/scoring-event-state.service';

@Component({
  selector: 'app-choose-event-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './choose-event-page.component.html'
})
export class ChooseEventPageComponent {
  readonly scoring = inject(ScoringEventStateService);
}
