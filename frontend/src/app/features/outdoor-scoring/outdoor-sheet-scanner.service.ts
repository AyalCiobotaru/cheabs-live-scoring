import { Injectable } from '@angular/core';
import Tesseract from 'tesseract.js';
import { OutdoorSheetScanMatch, OutdoorSheetScanResult, OutdoorSheetScanTeam } from './outdoor-scoring.models';

export interface OutdoorSheetScanProgress {
  status: string;
  progress: number;
}

interface TeamTable {
  rows: string[];
  hasLevelColumn: boolean;
  consumedIndexes: Set<number>;
}

@Injectable({
  providedIn: 'root'
})
export class OutdoorSheetScannerService {
  async scan(imageDataUrl: string, onProgress?: (progress: OutdoorSheetScanProgress) => void): Promise<OutdoorSheetScanResult> {
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: (message) => {
        onProgress?.({
          status: message.status,
          progress: message.progress
        });
      }
    });

    try {
      await worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.AUTO
      });
      const { data } = await worker.recognize(imageDataUrl);
      return this.normalizePoolSheetScan(this.parsePoolSheetText(data.text ?? ''));
    } finally {
      await worker.terminate();
    }
  }

  private parsePoolSheetText(text: string): OutdoorSheetScanResult {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const joined = lines.join('\n');
    const teamCount = this.detectTeamCount(joined) ?? (this.detectTeamSeeds(lines).length || null);
    const gameFormat = this.detectGameFormat(joined);
    const teamTable = this.extractTeamTable(lines, teamCount);
    const teams = this.detectTeams(lines, teamCount, teamTable);
    const linesWithoutTeams = this.removeConsumedLines(lines, teamTable.consumedIndexes);
    const matches = this.detectMatches(linesWithoutTeams, teamCount);
    const notes = ['Parsed with browser OCR. Review handwritten team names before scoring.'];

    if (matches.length === 0 && (teamCount === 4 || teamCount === 5)) {
      notes.push('Could not read the match rows clearly, so the default schedule for this pool size was used.');
    }

    return {
      title: this.detectTitle(lines, teamCount),
      teamCount,
      gamesPerMatch: gameFormat.gamesPerMatch,
      targetScore: gameFormat.targetScore,
      teams,
      matches: matches.length ? matches : this.defaultOutdoorSchedule(teamCount),
      notes
    };
  }

  private detectTitle(lines: string[], teamCount: number | null): string | null {
    const teamFormatLine = lines.find((line) => /\b[3-7]\s*[-\s]*teams?\b/i.test(line));

    if (teamFormatLine) {
      return teamFormatLine;
    }

    const poolLine = lines.find((line) => /\bpool\b/i.test(line) && !/\bteam\b/i.test(line));

    if (poolLine) {
      return poolLine;
    }

    return teamCount ? `${teamCount} Team Outdoor Pool` : null;
  }

  private detectTeamCount(text: string): number | null {
    const match = text.match(/\b(three|four|five|six|seven|[3-7])[\s-]+teams?(?:[\s-]+(?:pool|net))?\b/i);

    if (!match) {
      return null;
    }

    return Number(match[1]) || this.numberWord(match[1]);
  }

  private detectGameFormat(text: string): { gamesPerMatch: number | null; targetScore: number | null } {
    const lines = this.normalizePoolSheetText(text).split(/\r?\n/).filter(Boolean);
    const shorthandMatch = this.extractHandwrittenGameFormat(lines.join('\n'));
    const poolFormatLine = lines.find((line) => (
      /\b(?:competition|round robin|pool play)\b/i.test(line)
      && !/\bplayoffs?\b/i.test(line)
    ));
    const match = shorthandMatch
      ?? this.extractGameFormat(poolFormatLine)
      ?? this.extractGameFormat(lines.filter((line) => !/\bplayoffs?\b/i.test(line)).join('\n'));

    return {
      gamesPerMatch: match ? Number(match[1]) : null,
      targetScore: match ? Number(match[2]) : null
    };
  }

  private normalizePoolSheetText(text: string): string {
    return text
      .replace(/\b(one|two|three|four|five)\b/gi, (word) => String(this.numberWord(word)))
      .replace(/\b(games?|sets?)\s*of\b/gi, '$1 of')
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
  }

  private extractGameFormat(text = ''): RegExpMatchArray | null {
    return text.match(/\b([1-5])\s*(?:games?|sets?|set)\s*(?:during pool play\s*)?(?:is|are)?\s*(?:to|of|using|x)\s*([0-9]{1,2})\b/i)
      ?? text.match(/\b([1-5])\s*(?:games?|sets?|set)\s*(?:to|of|x)\s*([0-9]{1,2})\b/i);
  }

  private extractHandwrittenGameFormat(text = ''): RegExpMatchArray | null {
    const normalized = text
      .replace(/\btwo\b/gi, '2')
      .replace(/\b(?:too|t0|t\s+o)\b/gi, 'to')
      .replace(/(?<=\d)\s*[|/\\-]\s*(?=\d)/g, ' to ');
    const match = normalized.match(/\b2\s*(?:to|x)\s*(11|1\s*1|ll|l1|i1|ii|15|1\s*5|l5|i5|is|1s)\b/i);

    if (!match) {
      return null;
    }

    const targetScore = this.normalizeHandwrittenTargetScore(match[1]);
    return targetScore ? [match[0], '2', String(targetScore)] as unknown as RegExpMatchArray : null;
  }

  private normalizeHandwrittenTargetScore(value: string): number | null {
    const token = value.replace(/\s+/g, '').toLowerCase();

    if (['11', 'll', 'l1', 'i1', 'ii'].includes(token)) {
      return 11;
    }

    if (['15', 'l5', 'i5', 'is', '1s'].includes(token)) {
      return 15;
    }

    return null;
  }

  private detectTeamSeeds(lines: string[]): number[] {
    const seeds = new Set<number>();

    for (const line of lines) {
      const match = line.match(/^([1-7])(?:\s+|$)/);

      if (match) {
        seeds.add(Number(match[1]));
      }
    }

    return [...seeds].sort((a, b) => a - b);
  }

  private detectTeams(lines: string[], teamCount: number | null, table = this.extractTeamTable(lines, teamCount)): OutdoorSheetScanTeam[] {
    if (table.rows.length > 0) {
      return table.rows.map((line, index) => ({
        seed: index + 1,
        name: this.cleanTeamNameFromTableRow(line, table.hasLevelColumn)
      }));
    }

    return this.detectSeededTeamsFallback(lines, teamCount);
  }

  private extractTeamTable(lines: string[], teamCount: number | null): TeamTable {
    const headerIndex = lines.findIndex((line) => /\bteam\b.*\bteam\s+name\b/i.test(line));

    if (headerIndex < 0) {
      return {
        rows: [],
        hasLevelColumn: false,
        consumedIndexes: new Set()
      };
    }

    const header = lines[headerIndex];
    const rows: string[] = [];
    const consumedIndexes = new Set<number>([headerIndex]);
    const maxRows = teamCount ?? 7;

    for (let index = headerIndex + 1; index < lines.length; index += 1) {
      if (rows.length >= maxRows) {
        break;
      }

      const line = lines[index];

      if (this.isLikelyTeamTableRow(line)) {
        rows.push(line);
        consumedIndexes.add(index);
      }
    }

    return {
      rows,
      hasLevelColumn: /\blevel\b/i.test(header),
      consumedIndexes
    };
  }

  private removeConsumedLines(lines: string[], consumedIndexes: Set<number>): string[] {
    return lines.filter((_, index) => !consumedIndexes.has(index));
  }

  private isScheduleHeader(line: string): boolean {
    return /^match\b/i.test(line) || /^court\b/i.test(line);
  }

  private isLikelyTeamTableRow(line: string): boolean {
    return !/\b(?:vs|v5|ws)\b/i.test(line)
      && !/\b(?:competition|playoffs?)\b/i.test(line);
  }

  private cleanTeamNameFromTableRow(line: string, hasLevelColumn: boolean): string | null {
    const withoutSeedColumn = line.replace(/^\S+\s+/, '');
    const withoutLevelColumn = hasLevelColumn
      ? withoutSeedColumn.replace(/\s+\S+$/, '')
      : withoutSeedColumn;

    return this.cleanTeamName(withoutLevelColumn);
  }

  private detectSeededTeamsFallback(lines: string[], teamCount: number | null): OutdoorSheetScanTeam[] {
    const teams = new Map<number, string | null>();
    const maxSeed = teamCount ?? 7;
    let inTeamsSection = false;

    for (const line of lines) {
      if (/^teams?\b/i.test(line) && !/\bvs\b/i.test(line)) {
        inTeamsSection = true;
        continue;
      }

      if (this.isScheduleHeader(line)) {
        inTeamsSection = false;
      }

      const match = line.match(/^([1-7])\s+(.+)$/);

      if (!match || !inTeamsSection) {
        continue;
      }

      const seed = Number(match[1]);
      const name = this.cleanTeamName(match[2]);

      if (seed >= 1 && seed <= maxSeed) {
        teams.set(seed, name || null);
      }
    }

    return Array.from({ length: teamCount ?? teams.size }, (_, index) => {
      const seed = index + 1;
      return {
        seed,
        name: teams.get(seed) ?? null
      };
    });
  }

  private detectMatches(lines: string[], teamCount: number | null): OutdoorSheetScanMatch[] {
    const matches: OutdoorSheetScanMatch[] = [];

    for (const line of lines) {
      const match = this.parseScheduleRow(line, teamCount, matches.length);

      if (match) {
        matches.push(match);
      }
    }

    return matches;
  }

  private parseScheduleRow(line: string, teamCount: number | null, orderIndex: number): OutdoorSheetScanMatch | null {
    const normalized = this.normalizeScheduleRow(line);
    const playMatch = normalized.match(/\b([1-7])\s*(?:vs|v5|ws|w5|wz|v)\s*([1-7])\b/i);

    if (!playMatch) {
      return null;
    }

    const teamASeed = Number(playMatch[1]);
    const teamBSeed = Number(playMatch[2]);
    const afterPlay = normalized.slice((playMatch.index ?? 0) + playMatch[0].length);
    const defaultMatch = this.defaultOutdoorSchedule(teamCount)[orderIndex];
    const inferredRefSeed = this.sameMatchTeams(defaultMatch, teamASeed, teamBSeed) ? defaultMatch.refSeed : null;

    return {
      refSeed: this.detectWorkSeed(afterPlay, teamCount) ?? inferredRefSeed,
      teamASeed,
      teamBSeed
    };
  }

  private normalizeScheduleRow(line: string): string {
    return line
      .replace(/\bV5\b/gi, 'vs')
      .replace(/\bW5\b/gi, 'ws')
      .replace(/\bVS\b/g, 'vs')
      .replace(/\bWS\b/g, 'ws');
  }

  private detectWorkSeed(value: string, teamCount: number | null): number | null {
    const maxSeed = teamCount ?? 7;
    const tokens = value.split(/[\s|,;:*()[\]{}]+/).filter(Boolean);

    for (const token of tokens) {
      const seed = this.ocrSeedTokenToNumber(token);

      if (seed >= 1 && seed <= maxSeed) {
        return seed;
      }
    }

    return null;
  }

  private ocrSeedTokenToNumber(token: string): number {
    const cleaned = token.replace(/[^a-z0-9|!]/gi, '').toLowerCase();

    if (/^[1-7]$/.test(cleaned)) {
      return Number(cleaned);
    }

    if (['i', 'l', '|', '!', 'ji', 'j1'].includes(cleaned)) {
      return cleaned.startsWith('j') ? 3 : 1;
    }

    if (['j', 'ja'].includes(cleaned)) {
      return 3;
    }

    return 0;
  }

  private sameMatchTeams(match: OutdoorSheetScanMatch | undefined, teamASeed: number, teamBSeed: number): boolean {
    return Boolean(match)
      && ((match?.teamASeed === teamASeed && match.teamBSeed === teamBSeed)
        || (match?.teamASeed === teamBSeed && match.teamBSeed === teamASeed));
  }

  private defaultOutdoorSchedule(teamCount: number | null): OutdoorSheetScanMatch[] {
    if (teamCount === 4) {
      return [
        { refSeed: 1, teamASeed: 2, teamBSeed: 4 },
        { refSeed: 2, teamASeed: 1, teamBSeed: 3 },
        { refSeed: 3, teamASeed: 1, teamBSeed: 4 },
        { refSeed: 1, teamASeed: 2, teamBSeed: 3 },
        { refSeed: 2, teamASeed: 3, teamBSeed: 4 },
        { refSeed: 4, teamASeed: 1, teamBSeed: 2 }
      ];
    }

    if (teamCount === 5) {
      return [
        { refSeed: 3, teamASeed: 2, teamBSeed: 5 },
        { refSeed: 2, teamASeed: 1, teamBSeed: 4 },
        { refSeed: 1, teamASeed: 3, teamBSeed: 5 },
        { refSeed: 5, teamASeed: 2, teamBSeed: 4 },
        { refSeed: 4, teamASeed: 1, teamBSeed: 3 },
        { refSeed: 1, teamASeed: 4, teamBSeed: 5 },
        { refSeed: 4, teamASeed: 2, teamBSeed: 3 },
        { refSeed: 2, teamASeed: 1, teamBSeed: 5 },
        { refSeed: 5, teamASeed: 3, teamBSeed: 4 },
        { refSeed: 3, teamASeed: 1, teamBSeed: 2 }
      ];
    }

    return [];
  }

  private cleanTeamName(value: string): string | null {
    const cleaned = value
      .replace(/\bmatches?\s+won\b.*$/i, '')
      .replace(/\bgames?\s+won\b.*$/i, '')
      .replace(/\bvs\b.*$/i, '')
      .replace(/\bwinner\b.*$/i, '')
      .trim();

    return cleaned && !/^[|_\-.]+$/.test(cleaned) ? cleaned : null;
  }

  private numberWord(value: string): number | null {
    return {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7
    }[value.toLowerCase()] ?? null;
  }

  private normalizePoolSheetScan(scan: OutdoorSheetScanResult): OutdoorSheetScanResult {
    const teamCount = this.nullableInteger(scan.teamCount, 3, 7);
    const teams = Array.isArray(scan.teams)
      ? scan.teams.map((team) => ({
        seed: this.nullableInteger(team.seed, 1, 7),
        name: typeof team.name === 'string' && team.name.trim() ? team.name.trim() : null
      })).filter((team): team is OutdoorSheetScanTeam => team.seed != null)
      : [];
    const matches = Array.isArray(scan.matches)
      ? scan.matches.map((match) => ({
        refSeed: this.nullableInteger(match.refSeed, 1, 7),
        teamASeed: this.nullableInteger(match.teamASeed, 1, 7),
        teamBSeed: this.nullableInteger(match.teamBSeed, 1, 7)
      }))
      : [];
    const notes = Array.isArray(scan.notes)
      ? scan.notes.filter((note) => typeof note === 'string' && note.trim()).map((note) => note.trim())
      : [];

    return {
      title: typeof scan.title === 'string' && scan.title.trim() ? scan.title.trim() : null,
      teamCount,
      gamesPerMatch: this.nullableInteger(scan.gamesPerMatch, 1, 5),
      targetScore: this.nullableInteger(scan.targetScore, 1, 99),
      teams,
      matches,
      notes
    };
  }

  private nullableInteger(value: number | null, min: number, max: number): number | null {
    const number = Number(value);

    if (!Number.isInteger(number) || number < min || number > max) {
      return null;
    }

    return number;
  }
}
