import { auth } from './auth';
import { common } from './common';
import { photos } from './photos';
import { products } from './products';
import { releases } from './releases';
import { settings } from './settings';
import { shell } from './shell';

export const enUS = { common, shell, auth, products, photos, settings, releases } as const;
