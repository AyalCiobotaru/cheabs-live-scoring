import { GameScore } from '../models';

export const createId = (): string => {
  const browserCrypto = globalThis.crypto;

  if (typeof browserCrypto?.randomUUID === 'function') {
    return browserCrypto.randomUUID();
  }

  if (typeof browserCrypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    browserCrypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

export const wholeNumber = (value: unknown): number => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
};

export const clampWholeNumber = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, wholeNumber(value)));

export const seedOrNull = (seed: number | null, teamCount: number): number | null => {
  const value = wholeNumber(seed);
  return value >= 1 && value <= teamCount ? value : null;
};

export const resizeGamesForCount = (games: GameScore[], count: number): GameScore[] =>
  Array.from({ length: count }, (_, index) => {
    const existing = games[index];
    return {
      scoreA: wholeNumber(existing?.scoreA),
      scoreB: wholeNumber(existing?.scoreB),
      final: Boolean(existing?.final)
    };
  });
