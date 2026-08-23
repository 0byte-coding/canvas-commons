import {describe, expect, it} from 'vitest';
import {sampleGainEvents} from './gain';

describe('sampleGainEvents()', () => {
  it('returns the fallback for an empty envelope', () => {
    expect(sampleGainEvents([], 5, -12)).toBe(-12);
  });

  it('holds flat before the first and after the last event', () => {
    const events = [
      {time: 1, gain: -40},
      {time: 2, gain: -16},
    ];
    expect(sampleGainEvents(events, 0)).toBe(-40);
    expect(sampleGainEvents(events, 1)).toBe(-40);
    expect(sampleGainEvents(events, 2)).toBe(-16);
    expect(sampleGainEvents(events, 5)).toBe(-16);
  });

  it('interpolates linearly between adjacent events', () => {
    const events = [
      {time: 1, gain: -40},
      {time: 2, gain: -16},
    ];
    expect(sampleGainEvents(events, 1.5)).toBeCloseTo(-28);
    expect(sampleGainEvents(events, 1.25)).toBeCloseTo(-34);
  });

  it('handles zero-width segments without dividing by zero', () => {
    const events = [
      {time: 1, gain: -40},
      {time: 1, gain: -16},
    ];
    expect(sampleGainEvents(events, 1)).toBe(-40);
    expect(sampleGainEvents(events, 2)).toBe(-16);
  });
});
