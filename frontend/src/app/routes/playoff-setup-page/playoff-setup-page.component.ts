import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { PlayoffBracket, PlayoffConfiguration, PlayoffMatch } from '../../models';
import { ScoringEventStateService } from '../../service/scoring-event-state.service';
import { playoffMatchNumber, playoffWorkPlaceholder, regeneratePlayoffConfiguration } from '../../util/playoff-rules';

@Component({
  selector: 'app-playoff-setup-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './playoff-setup-page.component.html',
  styleUrl: './playoff-setup-page.component.scss'
})
export class PlayoffSetupPageComponent implements OnInit {
  readonly scoring = inject(ScoringEventStateService);
  private readonly route = inject(ActivatedRoute);
  readonly finishes = [1, 2, 3, 4, 5, 6, 7];

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('playoffId');
    if (!this.scoring.draftPlayoff && id) {
      const existing = this.scoring.event?.playoffs.find((candidate) => candidate.id === id);
      if (existing) this.scoring.draftPlayoff = JSON.parse(JSON.stringify(existing)) as PlayoffConfiguration;
    }
  }

  get playoff(): PlayoffConfiguration | null {
    return this.scoring.draftPlayoff;
  }

  toggleFinish(kind: 'gold' | 'silver', finish: number, checked: boolean): void {
    if (!this.playoff) return;
    const key = kind === 'gold' ? 'goldFinishes' : 'silverFinishes';
    const otherKey = kind === 'gold' ? 'silverFinishes' : 'goldFinishes';
    this.playoff[key] = checked
      ? [...new Set([...this.playoff[key], finish])].sort((a, b) => a - b)
      : this.playoff[key].filter((value) => value !== finish);
    if (checked) this.playoff[otherKey] = this.playoff[otherKey].filter((value) => value !== finish);
    this.regenerate();
  }

  regenerate(): void {
    if (!this.playoff) return;
    this.scoring.draftPlayoff = regeneratePlayoffConfiguration(
      this.playoff,
      this.scoring.playoffPools(this.playoff.category, this.playoff.division)
    );
  }

  rounds(bracket: PlayoffBracket): number[] {
    return [...new Set(bracket.matches.map((match) => match.round))].sort((a, b) => a - b);
  }

  matchNumber(bracket: PlayoffBracket, match: PlayoffMatch): number {
    return playoffMatchNumber(bracket, match);
  }

  workPlaceholder(config: PlayoffConfiguration, match: PlayoffMatch): string {
    return playoffWorkPlaceholder(config, match);
  }

  roundMatch(bracket: PlayoffBracket, round: number): PlayoffMatch | null {
    return bracket.matches.find((match) => match.round === round) ?? null;
  }

  applyRoundFormat(bracket: PlayoffBracket, round: number, source: PlayoffMatch): void {
    if (source.format.pointCap == null) source.format.decidingPointCap = null;
    for (const match of bracket.matches.filter((candidate) => candidate.round === round)) {
      match.format = { ...source.format };
      const gameCount = source.format.setsToWin * 2 - 1;
      match.games = Array.from(
        { length: gameCount },
        (_, index) => match.games[index] ?? { scoreA: 0, scoreB: 0, final: false }
      );
    }
  }
}
