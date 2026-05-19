import { PoolState } from './pool.models';

export interface TeamStanding {
  seed: number;
  name: string;
  wins: number;
  losses: number;
  pointDifferential: number;
}

export interface PoolCard {
  pool: PoolState;
  standings: TeamStanding[];
  completedMatches: number;
  totalMatches: number;
  matchSummary: string;
}

export interface DivisionPoolGroup {
  division: string;
  cards: PoolCard[];
}
