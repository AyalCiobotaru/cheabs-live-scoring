import { EventState } from './event.models';
import { Match } from './pool.models';

export interface CsvImportRow {
  lineNumber: number;
  values: Record<string, string>;
}

export interface CsvImportIssue {
  lineNumber: number | null;
  message: string;
}

export interface CsvImportPoolPreview {
  key: string;
  title: string;
  division: string;
  teamCount: number;
  gamesPerMatch: number;
  targetScore: number;
  pointCap: number | null;
  teams: { seed: number; name: string; lineNumber: number }[];
  matches: Match[];
}

export interface CsvImportPreview {
  fileName: string;
  eventCode: string;
  eventName: string;
  rows: CsvImportRow[];
  pools: CsvImportPoolPreview[];
  errors: CsvImportIssue[];
  warnings: CsvImportIssue[];
}

export interface CsvImportResponse {
  event?: EventState;
  errors?: CsvImportIssue[];
  warnings?: CsvImportIssue[];
  error?: string;
  message?: string;
}
