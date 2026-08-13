import type { D1DatabaseHandle } from './d1-database';
import type { NodeDatabaseHandle } from './node-database';

export type DatabaseHandle = D1DatabaseHandle | NodeDatabaseHandle;
