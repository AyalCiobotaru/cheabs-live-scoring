import {
  PlayoffBracket,
  PlayoffBracketKind,
  PlayoffConfiguration,
  PlayoffMatch,
  PlayoffMatchFormat,
  PlayoffSlotSource,
  PoolState
} from '../models';
import { createId } from './scoring-helpers';
import { buildStandings } from './standings-rules';

export const DEFAULT_PLAYOFF_FORMAT: PlayoffMatchFormat = {
  setsToWin: 1,
  targetScore: 25,
  pointCap: 27,
  decidingTargetScore: 15,
  decidingPointCap: 17
};

export const createPlayoffConfiguration = (
  category: string,
  division: string,
  pools: PoolState[]
): PlayoffConfiguration => {
  const now = new Date().toISOString();
  const config: PlayoffConfiguration = {
    id: createId(),
    category,
    division,
    published: false,
    editable: true,
    reseed: false,
    goldFinishes: [1, 2],
    silverFinishes: [3],
    gold: emptyBracket('gold', true),
    silver: emptyBracket('silver', true),
    sourceUpdatedAt: latestPoolUpdate(pools),
    unresolvedTiePoolIds: unresolvedTiePoolIds(pools),
    updatedAt: now
  };

  return regeneratePlayoffConfiguration(config, pools);
};

export const regeneratePlayoffConfiguration = (
  config: PlayoffConfiguration,
  pools: PoolState[]
): PlayoffConfiguration => {
  const gold = buildBracket('gold', true, config.goldFinishes, config.reseed, pools);
  const silver = buildBracket('silver', config.silver.enabled, config.silverFinishes, config.reseed, pools);
  const goldSemifinals = semifinalMatches(gold);
  const goldFinal = finalMatch(gold);
  const silverFinal = finalMatch(silver);

  if (goldFinal && goldSemifinals[0]) goldFinal.workSourceMatchId = goldSemifinals[0].id;
  if (silver.enabled && silverFinal && goldSemifinals[1]) silverFinal.workSourceMatchId = goldSemifinals[1].id;
  if (silver.enabled && silverFinal) {
    assignWorkFromSilverFinalist(goldSemifinals[0], silverFinal, 'A');
    assignWorkFromSilverFinalist(goldSemifinals[1], silverFinal, 'B');
  }

  return {
    ...config,
    gold,
    silver,
    sourceUpdatedAt: latestPoolUpdate(pools),
    unresolvedTiePoolIds: unresolvedTiePoolIds(pools),
    updatedAt: new Date().toISOString()
  };
};

export const poolsComplete = (pools: PoolState[]): boolean =>
  pools.length > 0 && pools.every((pool) => pool.matches.length > 0 && pool.matches.every((match) => match.final));

export const playoffTeamName = (pools: PoolState[], teamId: string | null): string => {
  if (!teamId) {
    return 'TBD';
  }

  for (const pool of pools) {
    const team = pool.teams.find((candidate) => candidate.id === teamId);
    if (team) {
      return team.name;
    }
  }

  return 'TBD';
};

export const winningTeamId = (match: PlayoffMatch): string | null => {
  let winsA = 0;
  let winsB = 0;
  for (const game of match.games.filter((candidate) => candidate.final)) {
    if (game.scoreA > game.scoreB) winsA += 1;
    if (game.scoreB > game.scoreA) winsB += 1;
  }
  if (winsA < match.format.setsToWin && winsB < match.format.setsToWin) return null;
  return winsA > winsB ? match.teamAId : match.teamBId;
};

export const playoffWorkPlaceholder = (config: PlayoffConfiguration, match: PlayoffMatch): string => {
  const assignment = playoffWorkAssignment(config, match);
  if (!assignment) return 'None';
  const { sourceMatchId, result } = assignment;

  for (const bracket of [config.gold, config.silver]) {
    const source = bracket.matches.find((candidate) => candidate.id === sourceMatchId);
    if (!source) continue;
    const finalRound = Math.max(...bracket.matches.map((candidate) => candidate.round), 0);
    const roundLabel = source.round === finalRound - 1 ? 'Semifinal' : `Round ${source.round + 1}, Match`;
    return `${result} of ${bracket.kind === 'gold' ? 'Gold' : 'Silver'} ${roundLabel} ${source.position + 1}`;
  }

  return `${result} of previous match`;
};

export const playoffResolvedWorkTeamId = (config: PlayoffConfiguration, match: PlayoffMatch): string | null => {
  if (match.workTeamId) return match.workTeamId;
  const assignment = playoffWorkAssignment(config, match);
  if (!assignment) return null;
  const source = [...config.gold.matches, ...config.silver.matches].find(
    (candidate) => candidate.id === assignment.sourceMatchId
  );
  if (!source?.final || !source.winnerTeamId) return null;
  if (assignment.result === 'Winner') return source.winnerTeamId;
  return source.winnerTeamId === source.teamAId ? source.teamBId : source.teamAId;
};

const playoffWorkAssignment = (
  config: PlayoffConfiguration,
  match: PlayoffMatch
): { sourceMatchId: string; result: 'Winner' | 'Loser' } | null => {
  let sourceMatchId = match.workSourceMatchId ?? match.workWinnerSourceMatchId;
  let result: 'Winner' | 'Loser' = match.workWinnerSourceMatchId ? 'Winner' : 'Loser';

  if (sourceMatchId && result === 'Loser') {
    const allMatches = [...config.gold.matches, ...config.silver.matches];
    const source = allMatches.find((candidate) => candidate.id === sourceMatchId);
    if (source && isByeMatch(source)) {
      const playedFeeder = [match.sourceA.matchId, match.sourceB.matchId]
        .map((id) => allMatches.find((candidate) => candidate.id === id))
        .find((candidate): candidate is PlayoffMatch => Boolean(candidate && !isByeMatch(candidate)));
      if (playedFeeder) sourceMatchId = playedFeeder.id;
    }
  }

  if (!sourceMatchId) {
    const goldFinal = finalMatch(config.gold);
    const goldSemifinals = semifinalMatches(config.gold);
    const silverFinal = finalMatch(config.silver);
    if (goldFinal?.id === match.id && goldSemifinals[0]) {
      sourceMatchId = goldSemifinals[0].id;
      result = 'Loser';
    } else if (config.silver.enabled && silverFinal?.id === match.id && goldSemifinals[1]) {
      sourceMatchId = goldSemifinals[1].id;
      result = 'Loser';
    }
  }

  return sourceMatchId ? { sourceMatchId, result } : null;
};

const isByeMatch = (match: PlayoffMatch): boolean =>
  match.sourceA.kind === 'bye' || match.sourceB.kind === 'bye';

const buildBracket = (
  kind: PlayoffBracketKind,
  enabled: boolean,
  finishes: number[],
  reseed: boolean,
  pools: PoolState[]
): PlayoffBracket => {
  if (!enabled) return emptyBracket(kind, false);
  const sources = participantSources(pools, finishes, reseed);
  if (sources.length < 2 || sources.length > 8) return emptyBracket(kind, true);
  const size = sources.length <= 2 ? 2 : sources.length <= 4 ? 4 : 8;
  const seeded = [...sources, ...Array.from({ length: size - sources.length }, () => byeSource())];
  const seedPairs =
    size === 2
      ? [[0, 1]]
      : size === 4
        ? [
            [0, 3],
            [1, 2]
          ]
        : [
            [0, 7],
            [3, 4],
            [1, 6],
            [2, 5]
          ];
  const matches: PlayoffMatch[] = seedPairs.map(([left, right], position) =>
    createMatch(kind, 0, position, seeded[left], seeded[right])
  );
  let prior = matches;
  let round = 1;
  while (prior.length > 1) {
    const next = Array.from({ length: prior.length / 2 }, (_, position) => {
      const feeders = [prior[position * 2], prior[position * 2 + 1]];
      const match = createMatch(
        kind,
        round,
        position,
        winnerSource(feeders[0]),
        winnerSource(feeders[1])
      );
      match.workSourceMatchId = feeders.find((candidate) => !isByeMatch(candidate))?.id ?? feeders[0].id;
      return match;
    });
    matches.push(...next);
    prior = next;
    round += 1;
  }
  resolveByes(matches);
  return { kind, enabled: true, matches, championTeamId: null };
};

const participantSources = (pools: PoolState[], finishes: number[], reseed: boolean): PlayoffSlotSource[] => {
  const ranked = pools.flatMap((pool) => {
    const standings = buildStandings(pool);
    return finishes.flatMap((finish) => {
      const standing = standings[finish - 1];
      return [
        {
          source: {
            kind: 'pool-finish' as const,
            poolId: pool.id,
            finish,
            teamId: pool.matches.every((match) => match.final) ? standing?.teamId : undefined,
            label: `${pool.title} #${finish}`
          },
          finish,
          standing
        }
      ];
    });
  });

  if (reseed) {
    ranked.sort(
      (left, right) =>
        left.finish - right.finish ||
        (right.standing?.wins ?? 0) - (left.standing?.wins ?? 0) ||
        (right.standing?.pointPercentage ?? 0) - (left.standing?.pointPercentage ?? 0)
    );
  } else if (pools.length === 2 && finishes.length === 2 && ranked.length === 4) {
    return [ranked[0].source, ranked[2].source, ranked[1].source, ranked[3].source];
  }

  return ranked.map((candidate) => candidate.source);
};

const createMatch = (
  bracket: PlayoffBracketKind,
  round: number,
  position: number,
  sourceA: PlayoffSlotSource,
  sourceB: PlayoffSlotSource
): PlayoffMatch => ({
  id: createId(),
  bracket,
  round,
  position,
  sourceA,
  sourceB,
  teamAId: sourceA.teamId ?? null,
  teamBId: sourceB.teamId ?? null,
  workTeamId: null,
  workSourceMatchId: null,
  workWinnerSourceMatchId: null,
  courtNumber: null,
  format: { ...DEFAULT_PLAYOFF_FORMAT },
  games: [{ scoreA: 0, scoreB: 0, final: false }],
  final: false,
  winnerTeamId: null,
  updatedAt: null
});

const resolveByes = (matches: PlayoffMatch[]): void => {
  for (const match of matches) {
    const onlyTeam = match.teamAId || match.teamBId;
    const hasBye = match.sourceA.kind === 'bye' || match.sourceB.kind === 'bye';
    if (!hasBye || !onlyTeam) continue;
    match.winnerTeamId = onlyTeam;
    for (const next of matches.filter((candidate) => candidate.round === match.round + 1)) {
      if (next.sourceA.matchId === match.id) next.teamAId = onlyTeam;
      if (next.sourceB.matchId === match.id) next.teamBId = onlyTeam;
    }
  }
};

const emptyBracket = (kind: PlayoffBracketKind, enabled: boolean): PlayoffBracket => ({
  kind,
  enabled,
  matches: [],
  championTeamId: null
});

const winnerSource = (match: PlayoffMatch): PlayoffSlotSource => ({
  kind: 'winner',
  matchId: match.id,
  label: `Winner of Round ${match.round + 1}, Match ${match.position + 1}`
});

const byeSource = (): PlayoffSlotSource => ({ kind: 'bye', label: 'Bye' });

const latestPoolUpdate = (pools: PoolState[]): string | null =>
  pools
    .map((pool) => pool.updatedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

const unresolvedTiePoolIds = (pools: PoolState[]): string[] =>
  pools
    .filter((pool) => {
      if (!pool.matches.every((match) => match.final)) return false;
      const standings = buildStandings(pool);
      return standings.some((standing, index) => {
        const next = standings[index + 1];
        return Boolean(
          next &&
          standing.wins === next.wins &&
          standing.losses === next.losses &&
          Math.abs(standing.pointPercentage - next.pointPercentage) < 0.000001
        );
      });
    })
    .map((pool) => pool.id);

const finalMatch = (bracket: PlayoffBracket): PlayoffMatch | null =>
  [...bracket.matches].sort((left, right) => right.round - left.round)[0] ?? null;

const semifinalMatches = (bracket: PlayoffBracket): PlayoffMatch[] => {
  const final = finalMatch(bracket);
  return final ? bracket.matches.filter((match) => match.round === final.round - 1) : [];
};

const assignWorkFromSilverFinalist = (
  goldSemifinal: PlayoffMatch | undefined,
  silverFinal: PlayoffMatch,
  side: 'A' | 'B'
): void => {
  if (!goldSemifinal) return;
  const teamId = side === 'A' ? silverFinal.teamAId : silverFinal.teamBId;
  const source = side === 'A' ? silverFinal.sourceA : silverFinal.sourceB;
  goldSemifinal.workTeamId = teamId;
  goldSemifinal.workSourceMatchId = null;
  goldSemifinal.workWinnerSourceMatchId = source.kind === 'winner' ? (source.matchId ?? null) : null;
};
