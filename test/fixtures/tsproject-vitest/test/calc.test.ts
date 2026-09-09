import { describe, expect, test } from 'vitest';
import { classify, describeNumber, safeDiv } from '../src/calc';

describe('classify', () => {
  test('both', () => {
    expect(classify(1, 1)).toBe('both');
  });
  test('x only', () => {
    expect(classify(1, -1)).toBe('x only');
  });
});

test('safeDiv', () => {
  expect(safeDiv(4, 2)).toBe(2);
  expect(safeDiv(1, 0)).toBeNull();
});

test('describeNumber names every kind of number', () => {
  expect(describeNumber(0)).toBe('zero');
  expect(describeNumber(-4)).toBe('negative even');
  expect(describeNumber(-3)).toBe('negative odd');
  expect(describeNumber(200)).toBe('big round');
  expect(describeNumber(101)).toBe('big');
  expect(describeNumber(4)).toBe('even');
  expect(describeNumber(3)).toBe('odd');
});
