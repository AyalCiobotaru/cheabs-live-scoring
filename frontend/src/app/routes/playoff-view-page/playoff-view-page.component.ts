import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { PlayoffBracket, PlayoffBracketKind, PlayoffConfiguration, PlayoffMatch } from '../../models';
import { ScoringEventStateService } from '../../service/scoring-event-state.service';
import {
  playoffResolvedWorkTeamId,
  playoffMatchNumber,
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
  mobileRounds: Record<PlayoffBracketKind, number> = { gold: 0, silver: 0 };

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

  matchNumber(bracket: PlayoffBracket, match: PlayoffMatch): number {
    return playoffMatchNumber(bracket, match);
  }

  activeMobileRound(bracket: PlayoffBracket): number {
    const availableRounds = this.rounds(bracket);
    const selectedRound = this.mobileRounds[bracket.kind];
    return availableRounds.includes(selectedRound) ? selectedRound : (availableRounds[0] ?? 0);
  }

  moveMobileRound(bracket: PlayoffBracket, change: number): void {
    const availableRounds = this.rounds(bracket);
    const currentIndex = availableRounds.indexOf(this.activeMobileRound(bracket));
    const nextIndex = Math.min(availableRounds.length - 1, Math.max(0, currentIndex + change));
    this.mobileRounds[bracket.kind] = availableRounds[nextIndex] ?? 0;
  }

  mobileRoundLabel(bracket: PlayoffBracket): string {
    const availableRounds = this.rounds(bracket);
    const activeRound = this.activeMobileRound(bracket);
    return activeRound === availableRounds.at(-1) ? 'Final' : `Round ${activeRound + 1}`;
  }

  teamName(teamId: string | null): string {
    return playoffTeamName(this.scoring.event?.pools ?? [], teamId);
  }

  slotName(match: PlayoffMatch, side: 'A' | 'B'): string {
    const teamId = side === 'A' ? match.teamAId : match.teamBId;
    if (teamId) return this.teamName(teamId);
    const source = side === 'A' ? match.sourceA : match.sourceB;
    if (source.kind === 'bye') return 'Bye';
    if (source.kind === 'winner' && source.matchId && this.playoff) {
      for (const bracket of [this.playoff.gold, this.playoff.silver]) {
        const sourceMatch = bracket.matches.find((candidate) => candidate.id === source.matchId);
        if (sourceMatch) return `Winner of Match ${this.matchNumber(bracket, sourceMatch)}`;
      }
    }
    return source.label;
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

  canScoreMatch(match: PlayoffMatch): boolean {
    return this.canScore() && Boolean(match.teamAId && match.teamBId) && !this.isByeMatch(match);
  }

  isByeMatch(match: PlayoffMatch): boolean {
    return match.sourceA.kind === 'bye' || match.sourceB.kind === 'bye';
  }

  hasWinner(match: PlayoffMatch): boolean {
    return Boolean(winningTeamId(match));
  }

  isWinner(match: PlayoffMatch, teamId: string | null): boolean {
    return Boolean(match.final && teamId && match.winnerTeamId === teamId);
  }

  currentGame(match: PlayoffMatch): { index: number; game: PlayoffMatch['games'][number] } | null {
    const activeIndex = match.games.findIndex((game, index) => this.canShowSet(match, index) && !game.final);
    if (activeIndex >= 0) return { index: activeIndex, game: match.games[activeIndex] };

    let lastFinalIndex = -1;
    for (let index = match.games.length - 1; index >= 0; index -= 1) {
      if (match.games[index].final) {
        lastFinalIndex = index;
        break;
      }
    }
    const index = lastFinalIndex >= 0 ? lastFinalIndex : 0;
    return match.games[index] ? { index, game: match.games[index] } : null;
  }

  finalizedGames(match: PlayoffMatch): PlayoffMatch['games'] {
    return match.games.filter((game) => game.final);
  }

  isCurrentSet(match: PlayoffMatch, gameIndex: number): boolean {
    const readyToScore = Boolean(match.teamAId && match.teamBId) && !this.isByeMatch(match);
    return readyToScore && !match.final && this.currentGame(match)?.index === gameIndex;
  }

  canReopenCompletedSet(match: PlayoffMatch, gameIndex: number): boolean {
    if (!this.scoring.isAdmin || this.isByeMatch(match) || !match.games[gameIndex]?.final) return false;
    return gameIndex === this.latestFinalizedSetIndex(match);
  }

  reopenCompletedSet(match: PlayoffMatch, gameIndex: number): void {
    if (!this.canReopenCompletedSet(match, gameIndex)) return;
    match.final = false;
    match.winnerTeamId = null;
    match.games[gameIndex].final = false;
    void this.scoring.handlePlayoffMatchChanged(this.playoffId, match);
  }

  private latestFinalizedSetIndex(match: PlayoffMatch): number {
    for (let index = match.games.length - 1; index >= 0; index -= 1) {
      if (match.games[index].final) return index;
    }
    return -1;
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
    if (!this.canScoreMatch(match) || match.final || game.final) return;
    if (side === 'A') game.scoreA = Math.max(0, game.scoreA + change);
    else game.scoreB = Math.max(0, game.scoreB + change);
    void this.scoring.handlePlayoffMatchChanged(this.playoffId, match);
  }

  setScore(match: PlayoffMatch, gameIndex: number, side: 'A' | 'B', value: unknown): void {
    const game = match.games[gameIndex];
    if (!this.canScoreMatch(match) || match.final || game.final) return;
    const parsed = Number(value);
    const cap = this.scoreCap(match, gameIndex);
    const score = Number.isInteger(parsed) ? Math.min(cap ?? Number.MAX_SAFE_INTEGER, Math.max(0, parsed)) : 0;
    if (side === 'A') game.scoreA = score;
    else game.scoreB = score;
    void this.scoring.handlePlayoffMatchChanged(this.playoffId, match);
  }

  disableScoreWheel(event: WheelEvent): void {
    (event.currentTarget as HTMLInputElement).blur();
  }

  clearZero(event: FocusEvent, score: unknown): void {
    const input = event.target as HTMLInputElement;
    if (Number(score) === 0) input.value = '';
  }

  restoreZero(event: FocusEvent): void {
    const input = event.target as HTMLInputElement;
    if (input.value === '') input.value = '0';
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

}
