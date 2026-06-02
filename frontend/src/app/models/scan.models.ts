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

export interface SheetScanBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SheetScanOcrLine {
  text: string;
  bounds: SheetScanBounds;
  confidence: number | null;
}

export interface SheetScanResult {
  title: string | null;
  division: string | null;
  teamCount: number | null;
  gamesPerMatch: number | null;
  targetScore: number | null;
  teams: SheetScanTeam[];
  matches: SheetScanMatch[];
  ocrLines: SheetScanOcrLine[];
  notes: string[];
}
