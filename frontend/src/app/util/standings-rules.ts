import { PoolCard, PoolState, TeamStanding } from '../models';
import { wholeNumber } from './scoring-helpers';

export const buildStandings = (pool: PoolState): TeamStanding[] => {
  const standings = new Map<number, TeamStanding>();

  for (const team of pool.teams) {
    standings.set(team.seed, {
      teamId: team.id,
      seed: team.seed,
      name: team.name,
      wins: 0,
      losses: 0,
      pointDifferential: 0,
      pointPercentage: 0
    });
  }

  const pointsFor = new Map<number, number>();
  const pointsTotal = new Map<number, number>();

  for (const match of pool.matches) {
    if (match.teamASeed == null || match.teamBSeed == null) {
      continue;
    }

    for (const game of match.games.filter((candidate) => candidate.final)) {
      const scoreA = wholeNumber(game.scoreA);
      const scoreB = wholeNumber(game.scoreB);
      pointsFor.set(match.teamASeed, (pointsFor.get(match.teamASeed) ?? 0) + scoreA);
      pointsFor.set(match.teamBSeed, (pointsFor.get(match.teamBSeed) ?? 0) + scoreB);
      pointsTotal.set(match.teamASeed, (pointsTotal.get(match.teamASeed) ?? 0) + scoreA + scoreB);
      pointsTotal.set(match.teamBSeed, (pointsTotal.get(match.teamBSeed) ?? 0) + scoreA + scoreB);
    }
  }

  for (const standing of standings.values()) {
    const total = pointsTotal.get(standing.seed) ?? 0;
    standing.pointPercentage = total > 0 ? (pointsFor.get(standing.seed) ?? 0) / total : 0;
  }

  for (const match of pool.matches) {
    if (match.teamASeed == null || match.teamBSeed == null) {
      continue;
    }

    const teamA = standings.get(match.teamASeed);
    const teamB = standings.get(match.teamBSeed);

    if (!teamA || !teamB) {
      continue;
    }

    for (const game of match.games) {
      if (!game.final) {
        continue;
      }

      const scoreA = wholeNumber(game.scoreA);
      const scoreB = wholeNumber(game.scoreB);

      if (scoreA === scoreB) {
        continue;
      }

      teamA.pointDifferential += scoreA - scoreB;
      teamB.pointDifferential += scoreB - scoreA;

      if (scoreA > scoreB) {
        teamA.wins += 1;
        teamB.losses += 1;
      } else {
        teamB.wins += 1;
        teamA.losses += 1;
      }
    }
  }

  return [...standings.values()].sort((left, right) => {
    return (
      right.wins - left.wins ||
      headToHeadWins(pool, right.seed, left.seed) - headToHeadWins(pool, left.seed, right.seed) ||
      right.pointPercentage - left.pointPercentage ||
      left.seed - right.seed
    );
  });
};

export const buildMatchSummary = (pool: PoolState): string => {
  const next = pool.matches.find((match) => !match.final);

  if (!next) {
    return 'Complete';
  }

  return `Next:\n${teamName(pool, next.teamASeed)}\nvs\n${teamName(pool, next.teamBSeed)}\nWork: ${teamName(pool, next.refSeed)}`;
};

export const teamName = (pool: PoolState, seed: number | null): string => {
  if (seed == null) {
    return 'None';
  }

  return pool.teams.find((team) => team.seed === seed)?.name ?? `Team ${seed}`;
};

export const buildPoolCard = (pool: PoolState): PoolCard => ({
  pool,
  standings: buildStandings(pool),
  completedMatches: pool.matches.filter((match) => match.final).length,
  totalMatches: pool.matches.length,
  matchSummary: buildMatchSummary(pool)
});

const headToHeadWins = (pool: PoolState, seed: number, opponentSeed: number): number => {
  let wins = 0;

  for (const match of pool.matches) {
    const involvesTeams =
      (match.teamASeed === seed && match.teamBSeed === opponentSeed) ||
      (match.teamASeed === opponentSeed && match.teamBSeed === seed);

    if (!involvesTeams) {
      continue;
    }

    for (const game of match.games) {
      if (!game.final) {
        continue;
      }

      const scoreA = wholeNumber(game.scoreA);
      const scoreB = wholeNumber(game.scoreB);

      if (scoreA === scoreB) {
        continue;
      }

      const winner = scoreA > scoreB ? match.teamASeed : match.teamBSeed;

      if (winner === seed) {
        wins += 1;
      }
    }
  }

  return wins;
};
