import {describe, expect, it} from 'vitest';
import {formatConstantGainVolume} from '../gainVolume';

describe('formatConstantGainVolume', () => {
  it('emits a dB volume for a finite gain', () => {
    expect(formatConstantGainVolume(-16)).toEqual({volume: '-16dB'});
  });

  it('emits linear silence for a muted (-Infinity dB) gain', () => {
    expect(formatConstantGainVolume(-Infinity)).toEqual({volume: '0'});
  });

  it('emits linear silence for NaN gain', () => {
    expect(formatConstantGainVolume(NaN)).toEqual({volume: '0'});
  });

  it('emits a dB volume for positive gain', () => {
    expect(formatConstantGainVolume(6)).toEqual({volume: '6dB'});
  });
});
