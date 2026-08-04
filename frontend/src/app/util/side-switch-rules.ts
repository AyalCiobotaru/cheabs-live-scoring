import { GameScore, Match, PoolState } from '../models';
import { wholeNumber } from './scoring-helpers';
import { teamName } from './standings-rules';

export interface SideSwitchToastState {
  message: string;
  detail: string;
}

export interface SideSwitchResult {
  lastKey: string | null;
  toast: SideSwitchToastState | null;
}

export const sideSwitchToastForScore = (
  pool: PoolState,
  match: Match,
  game: GameScore,
  lastKey: string | null
): SideSwitchResult => {
  const interval = sideSwitchInterval(pool.targetScore);
  const total = wholeNumber(game.scoreA) + wholeNumber(game.scoreB);
  const gameIndex = match.games.indexOf(game);
  const keyPrefix = `${pool.id}:${match.id}:${gameIndex}`;

  if (!interval || total <= 0 || total % interval !== 0) {
    return {
      lastKey: lastKey?.startsWith(`${keyPrefix}:`) ? null : lastKey,
      toast: null
    };
  }

  const key = `${keyPrefix}:${total}`;

  if (key === lastKey) {
    return {
      lastKey,
      toast: null
    };
  }

  return {
    lastKey: key,
    toast: {
      message: 'Switch sides',
      detail: `${teamName(pool, match.teamASeed)} and ${teamName(pool, match.teamBSeed)} should switch sides.`
    }
  };
};

const sideSwitchInterval = (targetScore: number): number | null => {
  if (targetScore === 11) {
    return 4;
  }

  if (targetScore === 15) {
    return 5;
  }

  return null;
};
