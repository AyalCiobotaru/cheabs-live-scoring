export interface Team {
  seed: number;
  name: string;
}

export interface GameScore {
  scoreA: number;
  scoreB: number;
  final: boolean;
}

export interface Match {
  id: string;
  courtNumber: number | null;
  refSeed: number | null;
  teamASeed: number | null;
  teamBSeed: number | null;
  games: GameScore[];
  final: boolean;
  updatedAt: string | null;
}

export interface PoolState {
  id: string;
  title: string;
  category: string;
  division: string;
  hidden: boolean;
  editable: boolean;
  teamCount: number;
  gamesPerMatch: number;
  targetScore: number;
  pointCap: number | null;
  matchStartTimerMinutes: number;
  courtNumbers: number[];
  nextMatchStartAt: string | null;
  nextMatchStartSourceMatchId: string | null;
  teams: Team[];
  matches: Match[];
  imagePreview: string | null;
  updatedAt: string | null;
}
