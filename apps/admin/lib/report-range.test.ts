import { describe, expect, it } from 'vitest';
import { resolveReportRange } from './report-range';

describe('resolveReportRange', () => {
  it('defaults to today when no period is given', () => {
    const range = resolveReportRange(undefined, undefined, undefined);
    expect(range.period).toBe('today');
    const spanMs = new Date(range.to).getTime() - new Date(range.from).getTime();
    expect(spanMs).toBe(24 * 60 * 60 * 1000);
  });

  it('7d spans exactly 7 whole days including today', () => {
    const range = resolveReportRange('7d', undefined, undefined);
    const spanMs = new Date(range.to).getTime() - new Date(range.from).getTime();
    expect(spanMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('30d spans exactly 30 whole days including today', () => {
    const range = resolveReportRange('30d', undefined, undefined);
    const spanMs = new Date(range.to).getTime() - new Date(range.from).getTime();
    expect(spanMs).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('custom uses the given from/to dates, end-exclusive the day after "to"', () => {
    const range = resolveReportRange('custom', '2026-01-01', '2026-01-05');
    expect(range.from).toBe('2026-01-01T00:00:00.000Z');
    expect(range.to).toBe('2026-01-06T00:00:00.000Z');
  });

  it('custom without a "to" falls back to today as the end date', () => {
    const range = resolveReportRange('custom', '2026-01-01', undefined);
    expect(range.period).toBe('custom');
    expect(new Date(range.to).getTime()).toBeGreaterThan(
      new Date(range.from).getTime(),
    );
  });

  it('custom without a "from" falls back to today instead of an invalid range', () => {
    const range = resolveReportRange('custom', undefined, undefined);
    expect(range.period).toBe('today');
  });
});
