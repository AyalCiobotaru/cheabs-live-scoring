import { EventState } from './event.models';
import { Match } from './pool.models';
import { PoolState } from './pool.models';

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
  category: string;
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

export interface SeededImportIssue {
  lineNumber: number | null;
  message: string;
}

export interface SeededImportFormat {
  gamesPerMatch: number;
  targetScore: number;
  pointCap: number | null;
  schedulePresetId: string;
}

export interface SeededImportFormats {
  4: SeededImportFormat;
  5: SeededImportFormat;
  6: SeededImportFormat;
  7: SeededImportFormat;
}

export interface SeededImportPreview {
  teams: { seed: number; name: string; lineNumber: number }[];
  pools: PoolState[];
  errors: SeededImportIssue[];
  warnings: SeededImportIssue[];
}

export interface SeededPoolsResponse {
  event?: EventState;
  errors?: SeededImportIssue[];
  error?: string;
  message?: string;
}
