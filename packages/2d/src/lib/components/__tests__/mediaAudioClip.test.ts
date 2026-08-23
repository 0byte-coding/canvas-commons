import {gainToDb, useMediaAudioAnalyzer} from '@canvas-commons/core';
import {describe, expect, it} from 'vitest';
import {GainTargetEvent, resolveGainEvents} from '../mediaAudioClip';

type Analyzer = ReturnType<typeof useMediaAudioAnalyzer>;

function analyzerReturning(gain: number): Analyzer {
  return {
    computeNormalizeGain: async () => gain,
  } as unknown as Analyzer;
}

describe('resolveGainEvents()', () => {
  it('maps volume targets straight to dB without measuring', async () => {
    let calls = 0;
    const analyzer = {
      computeNormalizeGain: async () => {
        calls++;
        return 0;
      },
    } as unknown as Analyzer;

    const targets: GainTargetEvent[] = [
      {time: 0, target: 0.5, mode: 'volume'},
      {time: 1, target: 1, mode: 'volume'},
    ];
    const events = await resolveGainEvents(analyzer, 'clip.mp3', targets);

    expect(calls).toBe(0);
    expect(events[0].gain).toBeCloseTo(gainToDb(0.5), 5);
    expect(events[1].gain).toBeCloseTo(0, 5);
  });

  it('offsets levelTo targets by the measured loudPart reference', async () => {
    // reference gain at target 0 is 20, so target -40 -> -20 and -16 -> +4.
    const analyzer = analyzerReturning(20);
    const targets: GainTargetEvent[] = [
      {time: 0, target: -40, mode: 'levelTo'},
      {time: 1, target: -16, mode: 'levelTo'},
    ];
    const events = await resolveGainEvents(analyzer, 'clip.mp3', targets);

    expect(events[0].gain).toBeCloseTo(-20, 5);
    expect(events[1].gain).toBeCloseTo(4, 5);
  });

  it('sorts the resolved events by time', async () => {
    const analyzer = analyzerReturning(0);
    const targets: GainTargetEvent[] = [
      {time: 2, target: 1, mode: 'volume'},
      {time: 0, target: 1, mode: 'volume'},
      {time: 1, target: 1, mode: 'volume'},
    ];
    const events = await resolveGainEvents(analyzer, 'clip.mp3', targets);

    expect(events.map(e => e.time)).toEqual([0, 1, 2]);
  });
});
