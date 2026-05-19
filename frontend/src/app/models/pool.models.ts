export interface Team {
  seed: number;
  name: string;
}

export interface GameScore {
  scoreA: number;
  scoreB: number;
}

export interface Match {
  id: string;
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
  division: string;
  teamCount: number;
  gamesPerMatch: number;
  targetScore: number;
  teams: Team[];
  matches: Match[];
  imagePreview: string | null;
  updatedAt: string | null;
}
