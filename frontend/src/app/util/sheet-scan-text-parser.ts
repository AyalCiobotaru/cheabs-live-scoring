import { DIVISION_OPTIONS } from './division-rules';

export const detectPoolSheetTitle = (lines: string[], teamCount: number | null): string | null => {
  const teamFormatLine = lines.find((line) => /\b[3-7]\s*[-\s]*teams?\b/i.test(line));

  if (teamFormatLine) {
    return teamFormatLine;
  }

  const poolLine = lines.find((line) => /\bpool\b/i.test(line) && !/\bteam\b/i.test(line));

  if (poolLine) {
    return poolLine;
  }

  return teamCount ? `${teamCount} Team Pool` : null;
};

export const detectPoolSheetDivision = (lines: string[]): string | null => {
  const divisionLine = lines.find((line) => /\bdivision\b/i.test(line));
  const match = divisionLine?.match(/\bdivision\s*:\s*(.+)$/i);
  const rawDivision = match?.[1]?.replace(/\b(?:women'?s|men'?s|coed)\b/gi, '').trim();
  const division = DIVISION_OPTIONS.find((option) => option.toLowerCase() === rawDivision?.toLowerCase());

  return division ?? null;
};

export const detectPoolSheetTeamCount = (text: string): number | null => {
  const match = text.match(/\b(three|four|five|six|seven|[3-7])[\s-]+teams?(?:[\s-]+(?:pool|net))?\b/i);

  if (match) {
    return Number(match[1]) || numberWord(match[1]);
  }

  const compactMatch = text.match(/\b([3-7])\s*team\s*(?:net|pool)?\b/i);
  return compactMatch ? Number(compactMatch[1]) : null;
};

export const detectPoolSheetGameFormat = (
  text: string
): { gamesPerMatch: number | null; targetScore: number | null } => {
  const lines = normalizePoolSheetText(text).split(/\r?\n/).filter(Boolean);
  const shorthandMatch = extractHandwrittenGameFormat(lines.join('\n'));
  const poolFormatLine = lines.find(
    (line) => /\b(?:competition|round robin|pool play)\b/i.test(line) && !/\bplayoffs?\b/i.test(line)
  );
  const match =
    shorthandMatch ??
    extractGameFormat(poolFormatLine) ??
    extractGameFormat(lines.filter((line) => !/\bplayoffs?\b/i.test(line)).join('\n'));
  const inferredFormat = match ? null : inferTemplateGameFormat(text);

  return {
    gamesPerMatch: match ? Number(match[1]) : inferredFormat?.gamesPerMatch ?? null,
    targetScore: match ? Number(match[2]) : inferredFormat?.targetScore ?? null
  };
};

export const detectPoolSheetTeamSeeds = (lines: string[]): number[] => {
  const seeds = new Set<number>();

  for (const line of lines) {
    const match = line.match(/^([1-7])(?:\s+|$)/);

    if (match) {
      seeds.add(Number(match[1]));
    }
  }

  return [...seeds].sort((a, b) => a - b);
};

const normalizePoolSheetText = (text: string): string =>
  text
    .replace(/\b(one|two|three|four|five)\b/gi, (word) => String(numberWord(word)))
    .replace(/\b(games?|sets?)\s*of\b/gi, '$1 of')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

const extractGameFormat = (text = ''): RegExpMatchArray | null =>
  text.match(
    /\b([1-5])\s*(?:games?|sets?|set)\s*(?:during pool play\s*)?(?:is|are)?\s*(?:to|of|using|x)\s*([0-9]{1,2})\b/i
  ) ?? text.match(/\b([1-5])\s*(?:games?|sets?|set)\s*(?:to|of|x)\s*([0-9]{1,2})\b/i);

const extractHandwrittenGameFormat = (text = ''): RegExpMatchArray | null => {
  const normalized = text
    .replace(/\btwo\b/gi, '2')
    .replace(/\b(?:too|t0|t\s+o)\b/gi, 'to')
    .replace(/(?<=\d)\s*[|/\\-]\s*(?=\d)/g, ' to ');
  const match = normalized.match(/\b2\s*(?:to|x)\s*(11|1\s*1|ll|l1|i1|ii|15|1\s*5|l5|i5|is|1s)\b/i);

  if (!match) {
    return null;
  }

  const targetScore = normalizeHandwrittenTargetScore(match[1]);
  return targetScore ? ([match[0], '2', String(targetScore)] as unknown as RegExpMatchArray) : null;
};

const normalizeHandwrittenTargetScore = (value: string): number | null => {
  const token = value.replace(/\s+/g, '').toLowerCase();

  if (['11', 'll', 'l1', 'i1', 'ii'].includes(token)) {
    return 11;
  }

  if (['15', 'l5', 'i5', 'is', '1s'].includes(token)) {
    return 15;
  }

  return null;
};

const inferTemplateGameFormat = (text: string): { gamesPerMatch: number; targetScore: number } | null => {
  const normalized = text.toLowerCase();

  if (/\b2\s*(?:games?|sets?)\b/.test(normalized) && /\b15\b/.test(normalized)) {
    return { gamesPerMatch: 2, targetScore: 15 };
  }

  if (/\b2\s*(?:games?|sets?)\b/.test(normalized) && /\b11\b/.test(normalized)) {
    return { gamesPerMatch: 2, targetScore: 11 };
  }

  return null;
};

const numberWord = (value: string): number | null =>
  ({
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7
  })[value.toLowerCase()] ?? null;
