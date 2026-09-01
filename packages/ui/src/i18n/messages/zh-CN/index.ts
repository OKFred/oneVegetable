import { auth } from './auth';
import { common } from './common';
import { photos } from './photos';
import { releases } from './releases';
import { settings } from './settings';
import { shell } from './shell';

export const zhCN = { common, shell, auth, photos, settings, releases } as const;
