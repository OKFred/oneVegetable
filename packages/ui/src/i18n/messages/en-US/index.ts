import { auth } from './auth';
import { capabilities } from './capabilities';
import { common } from './common';
import { insights } from './insights';
import { photos } from './photos';
import { products } from './products';
import { releases } from './releases';
import { rfqs } from './rfqs';
import { settings } from './settings';
import { shell } from './shell';

export const enUS = {
  common,
  shell,
  auth,
  products,
  photos,
  rfqs,
  insights,
  capabilities,
  settings,
  releases
} as const;
