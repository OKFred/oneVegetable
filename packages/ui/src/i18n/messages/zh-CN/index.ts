import { auth } from './auth';
import { admin } from './admin';
import { capabilities } from './capabilities';
import { common } from './common';
import { errors } from './errors';
import { insights } from './insights';
import { logistics } from './logistics';
import { orders } from './orders';
import { photos } from './photos';
import { products } from './products';
import { releases } from './releases';
import { rfqs } from './rfqs';
import { settings } from './settings';
import { shell } from './shell';

export const zhCN = {
  common,
  errors,
  admin,
  shell,
  auth,
  products,
  photos,
  rfqs,
  orders,
  insights,
  logistics,
  capabilities,
  settings,
  releases
} as const;
