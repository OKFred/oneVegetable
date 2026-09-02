import type { BackendMeta } from '@one-vegetable/core';

import { translateUi as t } from '../i18n';

export type ApplicationMode = 'mock' | 'extension' | 'bff';
export type RuntimeMetaStatus = 'loading' | 'ready' | 'error';
export type DataSourceId = 'mock' | 'replay' | 'real' | 'unavailable' | 'extension' | 'unknown';

export interface RuntimeState {
  backendMeta: BackendMeta | null;
  metaStatus: RuntimeMetaStatus;
}

export interface DataSourcePresentation {
  id: DataSourceId;
  label: string;
  description: string;
  dotClass: string;
}

export function resolveDataSource(mode: ApplicationMode, state?: RuntimeState): DataSourcePresentation {
  if (mode === 'mock') {
    return source(
      'mock',
      t('common.dataSource.mock.label'),
      t('common.dataSource.mock.description'),
      'bg-amber-500'
    );
  }
  if (mode === 'extension') {
    return source(
      'extension',
      t('common.dataSource.extension.label'),
      t('common.dataSource.extension.description'),
      'bg-emerald-500'
    );
  }
  if (!state || state.metaStatus === 'loading') {
    return source(
      'unknown',
      t('common.dataSource.detecting.label'),
      t('common.dataSource.detecting.description'),
      'bg-slate-400'
    );
  }
  if (state.metaStatus === 'error' || !state.backendMeta) {
    return source(
      'unavailable',
      t('common.dataSource.unavailable.label'),
      t('common.dataSource.unavailable.description'),
      'bg-rose-500'
    );
  }
  switch (state.backendMeta.gatewayMode) {
    case 'real':
      return source(
        'real',
        t('common.dataSource.real.label'),
        t('common.dataSource.real.description'),
        'bg-emerald-500'
      );
    case 'replay':
      return source(
        'replay',
        t('common.dataSource.replay.label'),
        t('common.dataSource.replay.description'),
        'bg-sky-500'
      );
    case 'mock':
      return source(
        'mock',
        t('common.dataSource.bffMock.label'),
        t('common.dataSource.bffMock.description'),
        'bg-amber-500'
      );
    case 'disabled':
      return source(
        'unavailable',
        t('common.dataSource.disabled.label'),
        t('common.dataSource.disabled.description'),
        'bg-rose-500'
      );
  }
}

function source(
  id: DataSourceId,
  label: string,
  description: string,
  dotClass: string
): DataSourcePresentation {
  return { id, label, description, dotClass };
}
