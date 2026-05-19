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
  teamCount: number;
  gamesPerMatch: number;
  targetScore: number;
  teams: Team[];
  matches: Match[];
  imagePreview: string | null;
  updatedAt: string | null;
}

export interface EventState {
  code: string;
  name: string;
  pools: PoolState[];
  activePoolId: string | null;
  updatedAt: string | null;
}

export interface TeamStanding {
  seed: number;
  name: string;
  wins: number;
  losses: number;
  pointDifferential: number;
}

export interface SheetScanTeam {
  seed: number;
  name: string | null;
}

export interface SheetScanMatch {
  refSeed: number | null;
  teamASeed: number | null;
  teamBSeed: number | null;
}

export interface SheetScanResult {
  title: string | null;
  teamCount: number | null;
  gamesPerMatch: number | null;
  targetScore: number | null;
  teams: SheetScanTeam[];
  matches: SheetScanMatch[];
  notes: string[];
}

export interface RealtimeSnapshot {
  clientId: string;
  eventCode: string;
  kind: 'event-updated' | 'pool-setup-updated' | 'match-updated' | 'event-snapshot-request' | 'event-snapshot';
  message: string;
  updatedAt: string;
  event?: EventState;
  pool?: PoolState;
  poolId?: string;
  match?: Match;
}

export interface SnapshotRequest {
  clientId: string;
  requestedAt: string;
}
