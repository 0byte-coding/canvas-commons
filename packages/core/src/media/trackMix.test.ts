import {describe, expect, it} from 'vitest';
import {
  AudioTrackMixMap,
  MEDIA_AUDIO_TRACK_ID,
  PROJECT_AUDIO_TRACK_ID,
  applyClipOffsets,
  audioTrackIdForSound,
  hasSoloedAudioTrack,
  normalizeTrackMix,
  resolveAudioMix,
} from './trackMix';

function mix(overrides: AudioTrackMixMap = {}): AudioTrackMixMap {
  return {
    [PROJECT_AUDIO_TRACK_ID]: {volume: 1, solo: false},
    [MEDIA_AUDIO_TRACK_ID]: {volume: 1, solo: false},
    ...overrides,
  };
}

describe('audioTrackIdForSound', () => {
  it('routes media-derived sounds to the media track', () => {
    expect(audioTrackIdForSound({sourceKey: 'video-1'})).toBe(
      MEDIA_AUDIO_TRACK_ID,
    );
    expect(audioTrackIdForSound({sourceKey: 'video-1', origin: 'media'})).toBe(
      MEDIA_AUDIO_TRACK_ID,
    );
  });

  it('routes plain sounds to the project track', () => {
    expect(audioTrackIdForSound({})).toBe(PROJECT_AUDIO_TRACK_ID);
    expect(audioTrackIdForSound({sourceKey: undefined})).toBe(
      PROJECT_AUDIO_TRACK_ID,
    );
  });

  it('routes audio-origin clips to the project track by default', () => {
    expect(audioTrackIdForSound({sourceKey: 'audio-1', origin: 'audio'})).toBe(
      PROJECT_AUDIO_TRACK_ID,
    );
  });

  it('honors an editor track assignment for audio clips', () => {
    const assignments = {audioKey: 'sfx'};
    expect(
      audioTrackIdForSound(
        {sourceKey: 'audioKey', origin: 'audio'},
        assignments,
      ),
    ).toBe('sfx');
  });

  it('ignores assignments for media clips', () => {
    const assignments = {videoKey: 'sfx'};
    expect(
      audioTrackIdForSound(
        {sourceKey: 'videoKey', origin: 'media'},
        assignments,
      ),
    ).toBe(MEDIA_AUDIO_TRACK_ID);
  });
});

describe('applyClipOffsets', () => {
  it('adds a per-clip offset to the sound offset', () => {
    const sounds = [
      {sourceKey: 'a', offset: 1},
      {sourceKey: 'b', offset: 2},
    ];
    const result = applyClipOffsets(sounds, {a: 0.5});
    expect(result[0].offset).toBe(1.5);
    expect(result[1].offset).toBe(2);
  });

  it('leaves keyless and unlisted sounds untouched by reference', () => {
    const sounds = [{offset: 3}, {sourceKey: 'x', offset: 4}];
    const result = applyClipOffsets(sounds, {});
    expect(result[0]).toBe(sounds[0]);
    expect(result[1]).toBe(sounds[1]);
  });
});

describe('resolveAudioMix', () => {
  it('passes through the master settings for a default track', () => {
    expect(resolveAudioMix(PROJECT_AUDIO_TRACK_ID, mix(), false, 0.5)).toEqual({
      muted: false,
      volume: 0.5,
    });
  });

  it('falls back to defaults for an unknown track', () => {
    expect(resolveAudioMix('unknown', {}, false, 1)).toEqual({
      muted: false,
      volume: 1,
    });
  });

  it('multiplies the track volume with the master volume', () => {
    const resolved = resolveAudioMix(
      PROJECT_AUDIO_TRACK_ID,
      mix({[PROJECT_AUDIO_TRACK_ID]: {volume: 0.5, solo: false}}),
      false,
      0.5,
    );
    expect(resolved.volume).toBeCloseTo(0.25);
  });

  it('mutes when the master is muted', () => {
    expect(resolveAudioMix(PROJECT_AUDIO_TRACK_ID, mix(), true, 1).muted).toBe(
      true,
    );
  });

  it('silences a track at volume 0 without a separate muted flag', () => {
    const resolved = resolveAudioMix(
      MEDIA_AUDIO_TRACK_ID,
      mix({[MEDIA_AUDIO_TRACK_ID]: {volume: 0, solo: false}}),
      false,
      1,
    );
    expect(resolved.volume).toBe(0);
  });

  it('silences non-soloed tracks when any track is soloed', () => {
    const soloed = mix({
      [MEDIA_AUDIO_TRACK_ID]: {volume: 1, solo: true},
    });
    expect(resolveAudioMix(MEDIA_AUDIO_TRACK_ID, soloed, false, 1).muted).toBe(
      false,
    );
    expect(
      resolveAudioMix(PROJECT_AUDIO_TRACK_ID, soloed, false, 1).muted,
    ).toBe(true);
  });

  it('keeps a soloed track silent when its own volume is 0', () => {
    const soloed = mix({
      [MEDIA_AUDIO_TRACK_ID]: {volume: 0, solo: true},
    });
    const resolved = resolveAudioMix(MEDIA_AUDIO_TRACK_ID, soloed, false, 1);
    expect(resolved.muted).toBe(false);
    expect(resolved.volume).toBe(0);
  });

  it('clamps out-of-range volumes', () => {
    const resolved = resolveAudioMix(
      PROJECT_AUDIO_TRACK_ID,
      mix({[PROJECT_AUDIO_TRACK_ID]: {volume: 5, solo: false}}),
      false,
      -1,
    );
    expect(resolved.volume).toBe(0);
  });
});

describe('hasSoloedAudioTrack', () => {
  it('detects soloed tracks', () => {
    expect(hasSoloedAudioTrack(mix())).toBe(false);
    expect(
      hasSoloedAudioTrack(
        mix({
          [PROJECT_AUDIO_TRACK_ID]: {volume: 1, solo: true},
        }),
      ),
    ).toBe(true);
  });
});

describe('normalizeTrackMix', () => {
  it('returns an empty map for invalid input', () => {
    expect(normalizeTrackMix(null)).toEqual({});
    expect(normalizeTrackMix(undefined)).toEqual({});
    expect(normalizeTrackMix('nope')).toEqual({});
  });

  it('coerces partial and malformed entries', () => {
    expect(
      normalizeTrackMix({
        a: {volume: 2, solo: undefined},
        b: {},
        c: null,
        d: {volume: NaN, solo: true},
      }),
    ).toEqual({
      a: {volume: 1, solo: false},
      b: {volume: 1, solo: false},
      d: {volume: 1, solo: true},
    });
  });

  it('migrates a persisted muted flag to volume 0', () => {
    expect(
      normalizeTrackMix({
        [PROJECT_AUDIO_TRACK_ID]: {volume: 0.8, muted: true, solo: false},
        [MEDIA_AUDIO_TRACK_ID]: {volume: 0.8, muted: false, solo: false},
      }),
    ).toEqual({
      [PROJECT_AUDIO_TRACK_ID]: {volume: 0, solo: false},
      [MEDIA_AUDIO_TRACK_ID]: {volume: 0.8, solo: false},
    });
  });

  it('preserves valid entries', () => {
    expect(
      normalizeTrackMix({
        [PROJECT_AUDIO_TRACK_ID]: {volume: 0.25, solo: false},
      }),
    ).toEqual({
      [PROJECT_AUDIO_TRACK_ID]: {volume: 0.25, solo: false},
    });
  });
});
