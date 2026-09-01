import { auth } from './auth';
import { common } from './common';
import { settings } from './settings';
import { shell } from './shell';

export const enUS = { common, shell, auth, settings } as const;
