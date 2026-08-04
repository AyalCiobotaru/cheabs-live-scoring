import { SheetScanOcrLine, SheetScanResult, SheetScanTeam } from '../models';
import { normalizeDivision } from './division-rules';

export const normalizePoolSheetScan = (scan: SheetScanResult): SheetScanResult => {
  const teamCount = nullableInteger(scan.teamCount, 3, 7);
  const teams = Array.isArray(scan.teams)
    ? scan.teams
        .map((team) => ({
          seed: nullableInteger(team.seed, 1, 7),
          name: typeof team.name === 'string' && team.name.trim() ? team.name.trim() : null
        }))
        .filter((team): team is SheetScanTeam => team.seed != null)
    : [];
  const matches = Array.isArray(scan.matches)
    ? scan.matches.map((match) => ({
        refSeed: nullableInteger(match.refSeed, 1, 7),
        teamASeed: nullableInteger(match.teamASeed, 1, 7),
        teamBSeed: nullableInteger(match.teamBSeed, 1, 7)
      }))
    : [];
  const notes = Array.isArray(scan.notes)
    ? scan.notes.filter((note) => typeof note === 'string' && note.trim()).map((note) => note.trim())
    : [];

  return {
    title: typeof scan.title === 'string' && scan.title.trim() ? scan.title.trim() : null,
    division: typeof scan.division === 'string' && scan.division.trim() ? normalizeDivision(scan.division) : null,
    teamCount,
    gamesPerMatch: nullableInteger(scan.gamesPerMatch, 1, 5),
    targetScore: nullableInteger(scan.targetScore, 1, 99),
    teams,
    matches,
    ocrLines: normalizeOcrLines(scan.ocrLines),
    notes
  };
};

export const normalizeOcrLines = (lines: SheetScanOcrLine[] | undefined): SheetScanOcrLine[] =>
  Array.isArray(lines)
    ? lines
        .map((line) => ({
          text: typeof line.text === 'string' ? line.text.replace(/\s+/g, ' ').trim() : '',
          bounds: {
            x: Number(line.bounds?.x) || 0,
            y: Number(line.bounds?.y) || 0,
            width: Number(line.bounds?.width) || 0,
            height: Number(line.bounds?.height) || 0
          },
          confidence: typeof line.confidence === 'number' ? line.confidence : null
        }))
        .filter((line) => line.text)
        .sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x)
    : [];

const nullableInteger = (value: number | null, min: number, max: number): number | null => {
  const number = Number(value);

  if (!Number.isInteger(number) || number < min || number > max) {
    return null;
  }

  return number;
};
