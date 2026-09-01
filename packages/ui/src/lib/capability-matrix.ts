import type { ApiCapability } from '@one-vegetable/core';

import type { DataSourcePresentation } from './data-source';
import { formatDateTime } from './date-time';

export type CapabilityMatrixVariant = 'success' | 'warning' | 'destructive' | 'secondary' | 'outline';

export interface CapabilityMatrixCell {
  label: string;
  detail: string;
  variant: CapabilityMatrixVariant;
}

export interface CapabilityMatrix {
  contract: CapabilityMatrixCell;
  replay: CapabilityMatrixCell;
  account: CapabilityMatrixCell;
  current: CapabilityMatrixCell;
}

export function capabilityMatrix(
  capability: ApiCapability,
  dataSource: DataSourcePresentation
): CapabilityMatrix {
  return {
    contract: contractCell(capability),
    replay: replayCell(capability),
    account: accountCell(capability),
    current: currentCell(capability, dataSource)
  };
}

function contractCell(capability: ApiCapability): CapabilityMatrixCell {
  if (!capability.enabled) {
    return cell('未接入', '该方法尚未进入可调用契约。', 'outline');
  }
  if (!capability.requestSchema || !capability.responseSchema) {
    return cell('契约不完整', '缺少请求或响应 Schema。', 'destructive');
  }
  return cell('已类型化', '请求、响应 Schema 和生成类型均已登记。', 'success');
}

function replayCell(capability: ApiCapability): CapabilityMatrixCell {
  const eligible =
    capability.enabled &&
    capability.lifecycle === 'active' &&
    capability.risk === 'read' &&
    capability.realCallEnabled &&
    !capability.restricted;
  return eligible
    ? cell('CI 已覆盖', '文档 Replay 样例通过当前请求和响应契约。', 'success')
    : cell('不适用', '该方法不属于 active、只读且允许真实调用的 Replay 候选。', 'secondary');
}

function accountCell(capability: ApiCapability): CapabilityMatrixCell {
  switch (capability.accountVerificationStatus ?? 'not-tested') {
    case 'passed':
      return cell('账号通过', accountDetail(capability, '历史 smoke 返回有效数据。'), 'success');
    case 'no-data':
      return cell(
        '合法空结果',
        accountDetail(capability, '历史 smoke 成功，但账号当时没有数据。'),
        'success'
      );
    case 'permission-denied':
      return cell('账号无权限', accountDetail(capability, '历史 smoke 被平台权限拒绝。'), 'warning');
    case 'contract-drift':
      return cell('契约漂移', accountDetail(capability, '历史 smoke 响应不符合当前契约。'), 'destructive');
    case 'provider-error':
      return cell('上游错误', accountDetail(capability, '历史 smoke 遇到平台或网络错误。'), 'destructive');
    case 'skipped-prerequisite':
      return cell(
        '缺前置数据',
        accountDetail(capability, '历史 smoke 缺少可用于调用的真实前置数据。'),
        'secondary'
      );
    case 'not-tested':
      return cell('未测试', '当前脱敏账号验证快照中没有该方法。', 'outline');
  }
}

function currentCell(capability: ApiCapability, dataSource: DataSourcePresentation): CapabilityMatrixCell {
  if (!capability.enabled) return cell('未接入', '当前应用没有该方法的可调用契约。', 'outline');
  if (capability.restricted) {
    return cell('能力受限', capability.restrictionReason ?? '该方法需要额外业务资格或上下文。', 'warning');
  }
  if (!capability.realCallEnabled) {
    return capability.risk === 'mutation'
      ? cell('写入关闭', '真实写入 feature flag 未开放。', 'warning')
      : cell('真实关闭', '该方法不允许通过真实网关调用。', 'warning');
  }

  switch (dataSource.id) {
    case 'mock':
      return cell('Mock 数据', dataSource.description, 'secondary');
    case 'replay':
      return cell('Replay 数据', dataSource.description, 'secondary');
    case 'real':
      return cell(
        '实时入口开放',
        '当前 BFF 使用 Alibaba 实时网关；单次调用仍可能被账号权限拒绝。',
        'success'
      );
    case 'extension':
      return cell(
        '扩展入口开放',
        '调用由扩展 service worker 发起；是否成功取决于本机凭据和平台权限。',
        'success'
      );
    case 'unavailable':
      return cell('网关不可用', dataSource.description, 'destructive');
    case 'unknown':
      return cell('来源检测中', dataSource.description, 'outline');
  }
}

function accountDetail(capability: ApiCapability, summary: string): string {
  const parts = [summary];
  if (capability.accountVerificationReasonCode) {
    parts.push(`原因码：${capability.accountVerificationReasonCode}`);
  }
  if (capability.accountVerificationCheckedAt) {
    parts.push(`检查时间：${formatDateTime(capability.accountVerificationCheckedAt)}`);
  }
  return parts.join(' ');
}

function cell(label: string, detail: string, variant: CapabilityMatrixVariant): CapabilityMatrixCell {
  return { label, detail, variant };
}
