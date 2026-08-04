import { Injectable } from '@angular/core';
import { SheetScanBounds, SheetScanMatch, SheetScanOcrLine, SheetScanResult, SheetScanTeam } from '../models';
import { normalizeOcrLines, normalizePoolSheetScan } from '../util/sheet-scan-normalizers';
import {
  detectPoolSheetDivision,
  detectPoolSheetGameFormat,
  detectPoolSheetTeamCount,
  detectPoolSheetTeamSeeds,
  detectPoolSheetTitle
} from '../util/sheet-scan-text-parser';

export interface SheetScanProgress {
  status: string;
  progress: number;
}

interface TeamTable {
  rows: string[];
  hasLevelColumn: boolean;
  consumedIndexes: Set<number>;
}

interface OcrResponse {
  text?: string;
  lines?: SheetScanOcrLine[];
}

@Injectable({
  providedIn: 'root'
})
export class SheetScannerService {
  async scan(
    imageDataUrl: string,
    onProgress?: (progress: SheetScanProgress) => void,
    adminPassword = ''
  ): Promise<SheetScanResult> {
    onProgress?.({ status: 'Uploading Pool Sheet to Google Vision...', progress: 0.2 });

    const response = await fetch('/api/scoring/sheet-ocr', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-admin-password': adminPassword
      },
      body: JSON.stringify({ imageDataUrl })
    });

    if (!response.ok) {
      throw new Error(await this.errorMessage(response));
    }

    onProgress?.({ status: 'Parsing Google Vision text...', progress: 0.8 });
    const body = (await response.json()) as OcrResponse;
    return normalizePoolSheetScan(this.parsePoolSheetOcr(body));
  }

  private parsePoolSheetOcr(ocr: OcrResponse): SheetScanResult {
    const ocrLines = normalizeOcrLines(ocr.lines);
    const sourceText = ocr.text ?? ocrLines.map((line) => line.text).join('\n');
    const lines = sourceText
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const joined = lines.join('\n');
    const teamCount = detectPoolSheetTeamCount(joined) ?? (detectPoolSheetTeamSeeds(lines).length || null);
    const gameFormat = detectPoolSheetGameFormat(joined);
    const teamTable = this.extractTeamTable(lines, teamCount);
    const teams = this.detectTeamsFromOcrLines(ocrLines, teamCount) ?? this.detectTeams(lines, teamCount, teamTable);
    const notes = [
      'Parsed with Google Vision OCR. Review handwritten team names before scoring.',
      'Schedule was generated from the pool size instead of parsed from the sheet.'
    ];

    return {
      title: detectPoolSheetTitle(lines, teamCount),
      division: detectPoolSheetDivision(lines),
      teamCount,
      gamesPerMatch: gameFormat.gamesPerMatch,
      targetScore: gameFormat.targetScore,
      teams,
      matches: [],
      ocrLines,
      notes
    };
  }

  private detectTeams(
    lines: string[],
    teamCount: number | null,
    table = this.extractTeamTable(lines, teamCount)
  ): SheetScanTeam[] {
    const numberedTeams = this.extractNumberedTeamRowsBeforeSchedule(lines, teamCount);

    if (numberedTeams.length > 0) {
      return numberedTeams;
    }

    if (table.rows.length > 0) {
      return table.rows.map((line, index) => {
        const numberedRow = this.extractNumberedTeamRow(line);

        return {
          seed: numberedRow?.seed ?? index + 1,
          name: this.cleanTeamNameFromTableRow(line, table.hasLevelColumn)
        };
      });
    }

    return this.detectSeededTeamsFallback(lines, teamCount);
  }

  private detectTeamsFromOcrLines(ocrLines: SheetScanOcrLine[], teamCount: number | null): SheetScanTeam[] | null {
    if (ocrLines.length === 0 || teamCount == null) {
      return null;
    }

    const header = this.findTeamHeaderLine(ocrLines);
    const sectionTop = header ? this.lineBottom(header) : 0;
    const sectionBottom =
      this.firstLineYAfter(ocrLines, sectionTop, /\bpool play format\b/i) ??
      this.firstLineYAfter(ocrLines, sectionTop, /\bwho won\b|\bmatch\s*\d/i) ??
      Number.POSITIVE_INFINITY;
    const pageWidth = Math.max(...ocrLines.map((line) => line.bounds.x + line.bounds.width), 1);
    const boundedTeams = this.detectTeamsFromSeedBounds(ocrLines, teamCount, sectionTop, sectionBottom, header, pageWidth);

    if (boundedTeams) {
      return boundedTeams;
    }

    const maxSeed = teamCount;
    const teams = new Map<number, string | null>();

    for (const line of ocrLines) {
      if (line.bounds.y <= sectionTop || line.bounds.y >= sectionBottom) {
        continue;
      }

      if (!this.isLikelyTeamColumnLine(line, header, pageWidth)) {
        continue;
      }

      const row = this.extractFlexibleNumberedTeamRow(line.text);

      if (!row || row.seed < 1 || row.seed > maxSeed) {
        continue;
      }

      const name = this.cleanTeamName(row.name);

      if (name) {
        teams.set(row.seed, name);
      }
    }

    if (teams.size < Math.min(teamCount, 2)) {
      return null;
    }

    return Array.from({ length: teamCount }, (_, index) => {
      const seed = index + 1;
      return {
        seed,
        name: teams.get(seed) ?? null
      };
    });
  }

  private detectTeamsFromSeedBounds(
    ocrLines: SheetScanOcrLine[],
    teamCount: number,
    sectionTop: number,
    sectionBottom: number,
    header: SheetScanOcrLine | null,
    pageWidth: number
  ): SheetScanTeam[] | null {
    const sectionLines = ocrLines.filter(
      (line) =>
        line.bounds.y > sectionTop &&
        line.bounds.y < sectionBottom &&
        this.isLikelyTeamColumnLine(line, header, pageWidth)
    );
    const seedRows = new Map<number, SheetScanOcrLine>();

    for (const line of sectionLines) {
      const row = this.extractFlexibleNumberedTeamRow(line.text);

      if (row && row.seed >= 1 && row.seed <= teamCount && !seedRows.has(row.seed)) {
        seedRows.set(row.seed, line);
      }
    }

    const firstSeedLine = seedRows.get(1);
    const lastSeedLine = seedRows.get(teamCount);

    if (!firstSeedLine || !lastSeedLine) {
      return null;
    }

    const zone = this.teamZoneBounds(firstSeedLine, lastSeedLine, [...seedRows.values()]);
    const rowHeight = zone.height / teamCount;

    if (!Number.isFinite(rowHeight) || rowHeight <= 0) {
      return null;
    }

    const teams = Array.from({ length: teamCount }, (_, index) => {
      const seed = index + 1;
      const bandTop = zone.y + index * rowHeight;
      const bandBottom = seed === teamCount ? zone.y + zone.height : bandTop + rowHeight;
      const bandText = sectionLines
        .filter((line) => this.lineIntersectsTeamBand(line, zone, bandTop, bandBottom))
        .sort((left, right) => left.bounds.x - right.bounds.x)
        .map((line) => line.text)
        .join(' ');
      const name = this.cleanTeamName(this.removeLeadingSeed(bandText, seed));

      return {
        seed,
        name
      };
    });

    const namedTeams = teams.filter((team) => team.name).length;
    return namedTeams >= Math.min(teamCount, 2) ? teams : null;
  }

  private teamZoneBounds(
    firstSeedLine: SheetScanOcrLine,
    lastSeedLine: SheetScanOcrLine,
    seedLines: SheetScanOcrLine[]
  ): SheetScanBounds {
    const left = firstSeedLine.bounds.x;
    const top = firstSeedLine.bounds.y;
    const right = Math.max(this.lineRight(lastSeedLine), ...seedLines.map((line) => this.lineRight(line)));
    const bottom = this.lineBottom(lastSeedLine);

    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    };
  }

  private lineIntersectsTeamBand(
    line: SheetScanOcrLine,
    zone: SheetScanBounds,
    bandTop: number,
    bandBottom: number
  ): boolean {
    const centerY = line.bounds.y + line.bounds.height / 2;
    const lineRight = this.lineRight(line);
    const zoneRight = zone.x + zone.width;

    return (
      centerY >= bandTop &&
      centerY < bandBottom &&
      line.bounds.x < zoneRight + 12 &&
      lineRight > zone.x - 12 &&
      this.isLikelyTeamBandText(line.text)
    );
  }

  private isLikelyTeamBandText(text: string): boolean {
    return (
      /[a-z]/i.test(text) &&
      !/\b(?:date|division|strive|games?\s+(?:won|lost)|point differential|pool play format|who won|refs?)\b/i.test(text)
    );
  }

  private removeLeadingSeed(text: string, seed: number): string {
    return text.replace(new RegExp(`^\\s*[|[\\]({]*\\s*${seed}\\s*[.)\\]-]?\\s*`, 'i'), '');
  }

  private findTeamHeaderLine(ocrLines: SheetScanOcrLine[]): SheetScanOcrLine | null {
    return (
      ocrLines.find((line) => /^team$/i.test(line.text)) ??
      ocrLines.find((line) => /\bteam\b/i.test(line.text) && !/\b(?:net|pool|games?\s+won|games?\s+lost)\b/i.test(line.text)) ??
      null
    );
  }

  private firstLineYAfter(ocrLines: SheetScanOcrLine[], y: number, pattern: RegExp): number | null {
    return ocrLines
      .filter((line) => line.bounds.y > y && pattern.test(line.text))
      .sort((left, right) => left.bounds.y - right.bounds.y)[0]?.bounds.y ?? null;
  }

  private isLikelyTeamColumnLine(line: SheetScanOcrLine, header: SheetScanOcrLine | null, pageWidth: number): boolean {
    if (/\b(?:games?\s+(?:won|lost)|point differential|pool play format|who won|refs?)\b/i.test(line.text)) {
      return false;
    }

    if (!header) {
      return line.bounds.x < pageWidth * 0.65;
    }

    const headerCenter = header.bounds.x + header.bounds.width / 2;
    const lineCenter = line.bounds.x + line.bounds.width / 2;
    const allowedDrift = Math.max(pageWidth * 0.32, header.bounds.width * 2.5);

    return lineCenter <= headerCenter + allowedDrift;
  }

  private extractNumberedTeamRowsBeforeSchedule(lines: string[], teamCount: number | null): SheetScanTeam[] {
    const teams = new Map<number, string | null>();
    const maxSeed = teamCount ?? 7;

    for (const line of lines) {
      if (/\bpool play format\b|\bwho won\b|\bmatch\s*\d/i.test(line)) {
        break;
      }

      const row = this.extractNumberedTeamRow(line);

      if (!row || row.seed < 1 || row.seed > maxSeed) {
        continue;
      }

      teams.set(row.seed, this.cleanTeamName(row.name));

      if (teamCount && teams.size >= teamCount) {
        break;
      }
    }

    return Array.from({ length: teamCount ?? teams.size }, (_, index) => {
      const seed = index + 1;
      return {
        seed,
        name: teams.get(seed) ?? null
      };
    }).filter((team) => team.name);
  }

  private extractTeamTable(lines: string[], teamCount: number | null): TeamTable {
    const headerIndex = lines.findIndex((line, index) => this.isTeamTableHeader(lines, index));

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

      if (/\bpool play format\b|\bwho won\b|\bmatch\s*\d/i.test(line)) {
        break;
      }

      if (this.extractNumberedTeamRow(line) && this.isLikelyTeamTableRow(line)) {
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
    return (
      !/\b(?:games?\s+(?:won|lost)|point differential|for each match|team)\b/i.test(line) &&
      !/\b(?:vs|v5|ws)\b/i.test(line) &&
      !/\b(?:competition|playoffs?)\b/i.test(line)
    );
  }

  private cleanTeamNameFromTableRow(line: string, hasLevelColumn: boolean): string | null {
    const numberedRow = this.extractNumberedTeamRow(line);
    const withoutSeedColumn =
      numberedRow?.name ?? line.replace(/^\s*[|[\]({]*\s*[1-7Il|!]\s*[.)\]-]*\s*/, '');
    const withoutLevelColumn = hasLevelColumn ? withoutSeedColumn.replace(/\s+\S+$/, '') : withoutSeedColumn;

    return this.cleanTeamName(withoutLevelColumn);
  }

  private isTeamTableHeader(lines: string[], index: number): boolean {
    const window = lines.slice(index, index + 5).join(' ');
    return /\bteam\b/i.test(window) && /\bgames?\s+won\b/i.test(window);
  }

  private extractNumberedTeamRow(line: string): { seed: number; name: string } | null {
    const match = line.match(/^\s*[|[\]({]*\s*([1-7])\s*[.)\]-]+\s*(.+?)\s*$/);

    if (!match) {
      return null;
    }

    return {
      seed: Number(match[1]),
      name: match[2]
    };
  }

  private extractFlexibleNumberedTeamRow(line: string): { seed: number; name: string } | null {
    const strictRow = this.extractNumberedTeamRow(line);

    if (strictRow) {
      return strictRow;
    }

    const looseMatch = line.match(/^\s*[|[\]({]*\s*([1-7])\s+(.+?)\s*$/);

    if (!looseMatch || !/[a-z]/i.test(looseMatch[2])) {
      return null;
    }

    return {
      seed: Number(looseMatch[1]),
      name: looseMatch[2]
    };
  }

  private detectSeededTeamsFallback(lines: string[], teamCount: number | null): SheetScanTeam[] {
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

  private detectMatches(lines: string[], teamCount: number | null): SheetScanMatch[] {
    const matches: SheetScanMatch[] = [];

    for (const line of lines) {
      const match = this.parseScheduleRow(line, teamCount, matches.length);

      if (match) {
        matches.push(match);
      }
    }

    return matches;
  }

  private parseScheduleRow(line: string, teamCount: number | null, orderIndex: number): SheetScanMatch | null {
    const normalized = this.normalizeScheduleRow(line);
    const playMatch = normalized.match(/\b([1-7])\s*(?:vs|v5|ws|w5|wz|v)\s*([1-7])\b/i);

    if (!playMatch) {
      return null;
    }

    const teamASeed = Number(playMatch[1]);
    const teamBSeed = Number(playMatch[2]);
    const afterPlay = normalized.slice((playMatch.index ?? 0) + playMatch[0].length);
    const defaultMatch = this.defaultSchedule(teamCount)[orderIndex];
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

  private sameMatchTeams(match: SheetScanMatch | undefined, teamASeed: number, teamBSeed: number): boolean {
    return (
      Boolean(match) &&
      ((match?.teamASeed === teamASeed && match.teamBSeed === teamBSeed) ||
        (match?.teamASeed === teamBSeed && match.teamBSeed === teamASeed))
    );
  }

  private defaultSchedule(teamCount: number | null): SheetScanMatch[] {
    if (teamCount === 4) {
      return [
        { refSeed: 1, teamASeed: 2, teamBSeed: 3 },
        { refSeed: 2, teamASeed: 1, teamBSeed: 4 },
        { refSeed: 3, teamASeed: 2, teamBSeed: 4 },
        { refSeed: 2, teamASeed: 1, teamBSeed: 3 },
        { refSeed: 1, teamASeed: 3, teamBSeed: 4 },
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
      .replace(/[\]|]+$/g, '')
      .trim();

    return cleaned && !/^[|_\-.]+$/.test(cleaned) ? cleaned : null;
  }

  private async errorMessage(response: Response): Promise<string> {
    const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
    return body.message || body.error || 'Unable to read the Pool Sheet with Google Vision.';
  }

  private lineBottom(line: SheetScanOcrLine): number {
    return line.bounds.y + line.bounds.height;
  }

  private lineRight(line: SheetScanOcrLine): number {
    return line.bounds.x + line.bounds.width;
  }
}
