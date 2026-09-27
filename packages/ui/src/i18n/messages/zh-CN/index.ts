import { auth } from './auth';
import { admin } from './admin';
import { capabilities } from './capabilities';
import { common } from './common';
import { errors } from './errors';
import { feedback } from './feedback';
import { orders } from './orders';
import { logs } from './logs';
import { photos } from './photos';
import { products } from './products';
import { releases } from './releases';
import { reviewPrompt } from './review-prompt';
import { rfqs } from './rfqs';
import { settings } from './settings';
import { shell } from './shell';

export const zhCN = {
  common,
  errors,
  feedback,
  admin,
  shell,
  auth,
  products,
  photos,
  rfqs,
  orders,
  logs,
  capabilities,
  settings,
  releases,
  reviewPrompt
} as const;
