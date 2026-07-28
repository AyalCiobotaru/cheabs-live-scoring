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
  category: string;
  division: string;
  cards: PoolCard[];
}

export interface CategoryPoolGroup {
  category: string;
  divisions: DivisionPoolGroup[];
  cards: PoolCard[];
}
