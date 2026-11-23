import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { PlayoffBracket, PlayoffConfiguration, PlayoffMatch } from '../../models';
import { ScoringEventStateService } from '../../service/scoring-event-state.service';
import {
  playoffResolvedWorkTeamId,
  playoffTeamName,
  playoffWorkPlaceholder,
  winningTeamId
} from '../../util/playoff-rules';

@Component({
  selector: 'app-playoff-view-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './playoff-view-page.component.html',
  styleUrl: './playoff-view-page.component.scss'
})
export class PlayoffViewPageComponent implements OnInit {
  readonly scoring = inject(ScoringEventStateService);
  private readonly route = inject(ActivatedRoute);
  playoffId = '';
  mobileRound = 0;

  ngOnInit(): void {
    this.playoffId = this.route.snapshot.paramMap.get('playoffId') ?? '';
  }

  get playoff() {
    this.scoring.version();
    return this.scoring.event?.playoffs.find((candidate) => candidate.id === this.playoffId) ?? null;
  }

  rounds(bracket: PlayoffBracket): number[] {
    return [...new Set(bracket.matches.map((match) => match.round))].sort((a, b) => a - b);
  }

  matches(bracket: PlayoffBracket, round: number): PlayoffMatch[] {
    return bracket.matches.filter((match) => match.round === round).sort((a, b) => a.position - b.position);
  }

  teamName(teamId: string | null): string {
    return playoffTeamName(this.scoring.event?.pools ?? [], teamId);
  }

  workLabel(config: PlayoffConfiguration, match: PlayoffMatch): string {
    const workTeamId = playoffResolvedWorkTeamId(config, match);
    if (workTeamId) return this.teamName(workTeamId);
    const placeholder = playoffWorkPlaceholder(config, match);
    return placeholder === 'None' ? '' : placeholder;
  }

  canScore(): boolean {
    return Boolean(this.playoff && (this.scoring.isAdmin || this.playoff.editable));
  }

  hasWinner(match: PlayoffMatch): boolean {
    return Boolean(winningTeamId(match));
  }

  canShowSet(match: PlayoffMatch, gameIndex: number): boolean {
    if (gameIndex === 0) return true;
    if (!match.games[gameIndex - 1]?.final) return false;

    let winsA = 0;
    let winsB = 0;
    for (const game of match.games.slice(0, gameIndex).filter((candidate) => candidate.final)) {
      if (game.scoreA > game.scoreB) winsA += 1;
      if (game.scoreB > game.scoreA) winsB += 1;
    }

    return winsA < match.format.setsToWin && winsB < match.format.setsToWin;
  }

  updateScore(match: PlayoffMatch, gameIndex: number, side: 'A' | 'B', change: number): void {
    const game = match.games[gameIndex];
    if (!this.canScore() || match.final || game.final) return;
    if (side === 'A') game.scoreA = Math.max(0, game.scoreA + change);
    else game.scoreB = Math.max(0, game.scoreB + change);
    void this.scoring.handlePlayoffMatchChanged(this.playoffId, match);
  }

  setScore(match: PlayoffMatch, gameIndex: number, side: 'A' | 'B', value: unknown): void {
    const game = match.games[gameIndex];
    if (!this.canScore() || match.final || game.final) return;
    const parsed = Number(value);
    const cap = this.scoreCap(match, gameIndex);
    const score = Number.isInteger(parsed) ? Math.min(cap ?? Number.MAX_SAFE_INTEGER, Math.max(0, parsed)) : 0;
    if (side === 'A') game.scoreA = score;
    else game.scoreB = score;
    void this.scoring.handlePlayoffMatchChanged(this.playoffId, match);
  }

  scoreCap(match: PlayoffMatch, gameIndex: number): number | null {
    const deciding = match.format.setsToWin > 1 && gameIndex === match.format.setsToWin * 2 - 2;
    return deciding ? match.format.decidingPointCap : match.format.pointCap;
  }

  markSetFinal(match: PlayoffMatch, gameIndex: number): void {
    if (!this.canScore() || match.final || !this.canMarkSetFinal(match, gameIndex)) return;
    match.games[gameIndex].final = true;
    void this.scoring.handlePlayoffMatchChanged(this.playoffId, match);
  }

  reopenSet(match: PlayoffMatch, gameIndex: number): void {
    if (!this.scoring.isAdmin || match.final) return;
    match.games[gameIndex].final = false;
    void this.scoring.handlePlayoffMatchChanged(this.playoffId, match);
  }

  canMarkSetFinal(match: PlayoffMatch, gameIndex: number): boolean {
    const game = match.games[gameIndex];
    const deciding = match.format.setsToWin > 1 && gameIndex === match.format.setsToWin * 2 - 2;
    const target = deciding ? match.format.decidingTargetScore : match.format.targetScore;
    const cap = deciding ? match.format.decidingPointCap : match.format.pointCap;
    const winningScore = Math.max(game.scoreA, game.scoreB);
    return (
      winningScore >= target && (Math.abs(game.scoreA - game.scoreB) >= 2 || (cap != null && winningScore === cap))
    );
  }

  markFinal(match: PlayoffMatch): void {
    if (!this.canScore() || !winningTeamId(match)) return;
    match.final = true;
    match.winnerTeamId = winningTeamId(match);
    void this.scoring.handlePlayoffMatchChanged(this.playoffId, match);
  }

  reopen(match: PlayoffMatch): void {
    if (!this.scoring.isAdmin) return;
    match.final = false;
    match.winnerTeamId = null;
    void this.scoring.handlePlayoffMatchChanged(this.playoffId, match);
  }
}
