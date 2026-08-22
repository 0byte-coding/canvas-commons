import {beforeEach, describe, expect, it, vi} from 'vitest';
import {Logger} from '../app';
import {Sound} from '../scenes';
import {AudioManager} from './AudioManager';
import {dbToGain} from './gain';

function makeManager(): AudioManager {
  const gainNode = {gain: {value: 1}, connect: vi.fn(), disconnect: vi.fn()};
  const sourceNode = {connect: vi.fn(), disconnect: vi.fn()};
  const context = {
    createGain: () => gainNode,
    createMediaElementSource: () => sourceNode,
    destination: {},
  } as unknown as AudioContext;
  return new AudioManager({} as Logger, context);
}

function gainOf(manager: AudioManager): number {
  return (manager as any).gainNode.gain.value;
}

function baseSound(overrides: Partial<Sound>): Sound {
  return {
    audio: 'clip.mp3',
    offset: 0,
    realPlaybackRate: 1,
    start: 0,
    end: 10,
    ...overrides,
  };
}

describe('AudioManager fades', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'playbackRate', 'get').mockReturnValue(
      1,
    );
  });

  it('does nothing when no fades are set', () => {
    const manager = makeManager();
    manager.setSound(baseSound({gain: 0}));
    manager.updateFade(5);
    expect(gainOf(manager)).toBeCloseTo(1, 5);
  });

  it('ramps in linearly over the fadeIn window', () => {
    const manager = makeManager();
    manager.setSound(baseSound({gain: 0, fadeIn: 4}));

    manager.updateFade(0);
    expect(gainOf(manager)).toBeCloseTo(0, 5);

    manager.updateFade(2);
    expect(gainOf(manager)).toBeCloseTo(0.5, 5);

    manager.updateFade(4);
    expect(gainOf(manager)).toBeCloseTo(1, 5);

    manager.updateFade(6);
    expect(gainOf(manager)).toBeCloseTo(1, 5);
  });

  it('ramps out linearly over the last fadeOut seconds', () => {
    const manager = makeManager();
    manager.setSound(baseSound({gain: 0, fadeOut: 5, end: 10}));

    manager.updateFade(4);
    expect(gainOf(manager)).toBeCloseTo(1, 5);

    manager.updateFade(5);
    expect(gainOf(manager)).toBeCloseTo(1, 5);

    manager.updateFade(7.5);
    expect(gainOf(manager)).toBeCloseTo(0.5, 5);

    manager.updateFade(10);
    expect(gainOf(manager)).toBeCloseTo(0, 5);
  });

  it('scales the fade against the base gain', () => {
    const manager = makeManager();
    const gainDb = -6;
    manager.setSound(baseSound({gain: gainDb, fadeOut: 4, end: 10}));

    manager.updateFade(8);
    expect(gainOf(manager)).toBeCloseTo(dbToGain(gainDb) * 0.5, 5);
  });

  it('falls back to the file duration when the clip has no end', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(20);
    const manager = makeManager();
    manager.setSound(baseSound({gain: 0, fadeOut: 5, end: undefined}));

    manager.updateFade(14);
    expect(gainOf(manager)).toBeCloseTo(1, 5);

    manager.updateFade(17.5);
    expect(gainOf(manager)).toBeCloseTo(0.5, 5);

    manager.updateFade(20);
    expect(gainOf(manager)).toBeCloseTo(0, 5);
  });

  it('respects the clip offset when computing elapsed time', () => {
    const manager = makeManager();
    manager.setSound(baseSound({gain: 0, offset: 3, fadeIn: 2, end: 10}));

    manager.updateFade(3);
    expect(gainOf(manager)).toBeCloseTo(0, 5);

    manager.updateFade(4);
    expect(gainOf(manager)).toBeCloseTo(0.5, 5);
  });
});
