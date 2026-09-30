import type { LiveTopic } from '../../shared/src/index.ts';
import type { Db } from './db.ts';

export interface Ctx {
  db: Db;
  /** Tell every open screen to refresh these topics. */
  changed: (...topics: LiveTopic[]) => void;
}
