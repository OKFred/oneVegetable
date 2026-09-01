import { auth } from './auth';
import { common } from './common';
import { releases } from './releases';
import { settings } from './settings';
import { shell } from './shell';

export const zhCN = { common, shell, auth, settings, releases } as const;
