export interface ScanSummary {
  read: string[];
  assumed: string[];
  manual: string[];
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
