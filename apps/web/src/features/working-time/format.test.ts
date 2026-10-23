import { describe, expect, it } from 'vitest';
import { addDays, formatMinutes, formatSigned, parseDuration, utilizationTone, weekStartOf } from './format';

describe('working-time formatting', () => {
  it('formats durations as h:mm', () => {
    expect(formatMinutes(450)).toBe('7:30');
    expect(formatMinutes(-75)).toBe('−1:15');
    expect(formatSigned(30)).toBe('+0:30');
    expect(formatSigned(0)).toBe('0:00');
  });

  it('parses clock and decimal durations', () => {
    expect(parseDuration('7:30')).toBe(450);
    expect(parseDuration('7,5')).toBe(450);
    expect(parseDuration('0.25')).toBe(15);
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('')).toBeNull();
  });

  it('navigates weeks with Monday start', () => {
    expect(weekStartOf('2026-10-25')).toBe('2026-10-19');
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04');
  });

  it('classifies utilization', () => {
    expect([null, 20, 60, 95, 120].map(utilizationTone)).toEqual(['none', 'low', 'ok', 'high', 'over']);
  });
});
