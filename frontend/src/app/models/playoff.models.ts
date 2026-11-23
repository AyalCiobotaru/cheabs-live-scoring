import { GameScore } from './pool.models';

export type PlayoffBracketKind = 'gold' | 'silver';

export interface PlayoffMatchFormat {
  setsToWin: number;
  targetScore: number;
  pointCap: number | null;
  decidingTargetScore: number;
  decidingPointCap: number | null;
}

export interface PlayoffSlotSource {
  kind: 'pool-finish' | 'winner' | 'team' | 'bye';
  poolId?: string;
  finish?: number;
  matchId?: string;
  teamId?: string;
  label: string;
}

export interface PlayoffMatch {
  id: string;
  bracket: PlayoffBracketKind;
  round: number;
  position: number;
  sourceA: PlayoffSlotSource;
  sourceB: PlayoffSlotSource;
  teamAId: string | null;
  teamBId: string | null;
  workTeamId: string | null;
  workSourceMatchId: string | null;
  workWinnerSourceMatchId: string | null;
  courtNumber: number | null;
  format: PlayoffMatchFormat;
  games: GameScore[];
  final: boolean;
  winnerTeamId: string | null;
  updatedAt: string | null;
}

export interface PlayoffBracket {
  kind: PlayoffBracketKind;
  enabled: boolean;
  matches: PlayoffMatch[];
  championTeamId: string | null;
}

export interface PlayoffConfiguration {
  id: string;
  category: string;
  division: string;
  published: boolean;
  editable: boolean;
  reseed: boolean;
  goldFinishes: number[];
  silverFinishes: number[];
  gold: PlayoffBracket;
  silver: PlayoffBracket;
  sourceUpdatedAt: string | null;
  unresolvedTiePoolIds: string[];
  updatedAt: string | null;
}
