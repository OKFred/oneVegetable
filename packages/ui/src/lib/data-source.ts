import type { BackendMeta } from '@one-vegetable/core';

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
    return source('mock', '本地 Mock', '数据来自 mock/data 契约样例，不会请求 Alibaba。', 'bg-amber-500');
  }
  if (mode === 'extension') {
    return source(
      'extension',
      '扩展实时网关',
      '请求由 MV3 service worker 发起；失败时不回退 Mock。',
      'bg-emerald-500'
    );
  }
  if (!state || state.metaStatus === 'loading') {
    return source('unknown', 'BFF 来源检测中', '正在读取后端运行模式。', 'bg-slate-400');
  }
  if (state.metaStatus === 'error' || !state.backendMeta) {
    return source(
      'unavailable',
      'BFF 来源不可用',
      '无法确认后端数据来源；业务请求不会回退 Mock。',
      'bg-rose-500'
    );
  }
  switch (state.backendMeta.gatewayMode) {
    case 'real':
      return source(
        'real',
        'Alibaba 实时数据',
        'BFF 正在代理 Alibaba 实时接口；失败时不回退 Mock。',
        'bg-emerald-500'
      );
    case 'replay':
      return source('replay', '文档 Replay', 'BFF 使用已审计的文档回放，不连接 Alibaba。', 'bg-sky-500');
    case 'mock':
      return source('mock', 'BFF Mock', 'BFF 返回本地契约 Mock 数据。', 'bg-amber-500');
    case 'disabled':
      return source('unavailable', '业务网关已关闭', 'BFF 可用，但 Alibaba 业务请求已禁用。', 'bg-rose-500');
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
