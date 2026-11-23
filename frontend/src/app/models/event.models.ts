import { PoolState } from './pool.models';
import { PlayoffConfiguration } from './playoff.models';

export interface EventState {
  code: string;
  name: string;
  pools: PoolState[];
  playoffs: PlayoffConfiguration[];
  activePoolId: string | null;
  updatedAt: string | null;
}
