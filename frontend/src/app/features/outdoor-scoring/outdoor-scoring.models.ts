export interface OutdoorTeam {
  seed: number;
  name: string;
}

export interface OutdoorGameScore {
  scoreA: number;
  scoreB: number;
}

export interface OutdoorMatch {
  id: string;
  refSeed: number | null;
  teamASeed: number | null;
  teamBSeed: number | null;
  games: OutdoorGameScore[];
  final: boolean;
}

export interface OutdoorPoolState {
  title: string;
  teamCount: number;
  gamesPerMatch: number;
  targetScore: number;
  teams: OutdoorTeam[];
  matches: OutdoorMatch[];
  imagePreview: string | null;
  updatedAt: string | null;
}

export interface OutdoorTeamStanding {
  seed: number;
  name: string;
  wins: number;
  losses: number;
  pointDifferential: number;
}

export interface OutdoorSheetScanTeam {
  seed: number;
  name: string | null;
}

export interface OutdoorSheetScanMatch {
  refSeed: number | null;
  teamASeed: number | null;
  teamBSeed: number | null;
}

export interface OutdoorSheetScanResult {
  title: string | null;
  teamCount: number | null;
  gamesPerMatch: number | null;
  targetScore: number | null;
  teams: OutdoorSheetScanTeam[];
  matches: OutdoorSheetScanMatch[];
  notes: string[];
}

export interface OutdoorRealtimeSnapshot {
  clientId: string;
  kind: 'pool-updated' | 'score-updated';
  message: string;
  updatedAt: string;
  pool: OutdoorPoolState;
}

export interface OutdoorSnapshotRequest {
  clientId: string;
  requestedAt: string;
}
