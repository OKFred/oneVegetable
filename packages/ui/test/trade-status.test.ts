import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { uiI18n } from '../src/i18n';
import {
  tradeLogisticsStatusLabel,
  tradeOrderStatusLabel,
  tradePaymentStatusLabel
} from '../src/lib/trade-status';

beforeEach(() => {
  uiI18n.global.locale.value = 'zh-CN';
});
afterEach(() => {
  uiI18n.global.locale.value = 'zh-CN';
});

describe('trade status presentation', () => {
  it('normalizes display casing without changing the order value', () => {
    const order = { status: '  UnPaY  ' };
    expect(tradeOrderStatusLabel(order.status)).toBe('待付款');
    expect(order.status).toBe('  UnPaY  ');
    expect(tradePaymentStatusLabel('paid')).toBe('已支付');
    expect(tradeLogisticsStatusLabel('pArT_DeLiVeReD')).toBe('部分发货');
  });

  it('does not borrow a success predicate from a different status domain', () => {
    expect(tradeOrderStatusLabel('FULFILLED')).toBe('未知状态（FULFILLED）');
    expect(tradeOrderStatusLabel('PAY_SUCCESS')).toBe('未知状态（PAY_SUCCESS）');
    expect(tradePaymentStatusLabel('trade_success')).toBe('未知状态（trade_success）');
    expect(tradePaymentStatusLabel('FULFILLED')).toBe('款项已收齐');
    expect(tradeOrderStatusLabel('trade_success')).toBe('交易完成');
  });

  it('keeps undocumented IOP detail values and unusual names visible as unknown', () => {
    expect(tradeOrderStatusLabel('SHIPPED')).toBe('未知状态（SHIPPED）');
    expect(tradeOrderStatusLabel('WAITING')).toBe('未知状态（WAITING）');
    expect(tradeOrderStatusLabel('constructor')).toBe('未知状态（constructor）');
    expect(tradeLogisticsStatusLabel('__proto__')).toBe('未知状态（__proto__）');
  });

  it('shows absent and adapter-placeholder statuses as unknown rather than success', () => {
    for (const value of [undefined, null, '', '   ', 'UNKNOWN']) {
      expect(tradeOrderStatusLabel(value)).toBe('状态未知');
      expect(tradePaymentStatusLabel(value)).toBe('状态未知');
      expect(tradeLogisticsStatusLabel(value)).toBe('状态未知');
    }
  });

  it('translates each payment result in mixed receipts and resolves the current locale', () => {
    const receipt = ' PAID, , UNPAY, Future-Code ';
    expect(tradePaymentStatusLabel(receipt)).toBe('已支付、未支付、未知状态（Future-Code）');
    uiI18n.global.locale.value = 'en-US';
    expect(tradePaymentStatusLabel(receipt)).toBe('Paid, Unpaid, Unknown status (Future-Code)');
    expect(tradeOrderStatusLabel('unpay')).toBe('Awaiting payment');
    expect(tradeLogisticsStatusLabel('confirm_receipt')).toBe('Receipt confirmed');
    expect(tradeOrderStatusLabel(null)).toBe('Unknown status');
    expect(receipt).toBe(' PAID, , UNPAY, Future-Code ');
  });
});
