import { PoolState } from './pool.models';

export interface EventState {
  code: string;
  name: string;
  pools: PoolState[];
  activePoolId: string | null;
  updatedAt: string | null;
}
