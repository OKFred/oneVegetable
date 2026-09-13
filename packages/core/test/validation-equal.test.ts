import { it, expect } from 'vitest';
import { validationEqual } from '../src/validation-equal';
it('compares JSON enum values without coercion or key-order dependence', () => {
  expect(validationEqual({ a: [1, null, { b: 'x' }] }, { a: [1, null, { b: 'x' }] })).toBe(true);
  expect(validationEqual({ b: 2, a: 1 }, { a: 1, b: 2 })).toBe(true);
  expect(validationEqual(1, '1')).toBe(false);
  expect(validationEqual([1], [1, 2])).toBe(false);
  expect(validationEqual([1], { '0': 1 })).toBe(false);
  expect(validationEqual({ a: null }, {})).toBe(false);
  expect(validationEqual(null, {})).toBe(false);
});
