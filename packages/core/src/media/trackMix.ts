import {clamp} from '../tweening';

/**
 * Identifier of the timeline track a sound belongs to.
 *
 * @remarks
 * Until multiple project audio tracks land, sounds are split into just two
 * tracks: the auto-populated media lane and the project audio track.
 */
export type AudioTrackId = string;

export const MEDIA_AUDIO_TRACK_ID: AudioTrackId = 'media';
export const PROJECT_AUDIO_TRACK_ID: AudioTrackId = 'project';

/**
 * Definition of a user-managed project audio track.
 *
 * @remarks
 * Purely visual grouping - tracks carry no audio properties themselves. Which
 * track a clip sits on is preview/editor-only and does not affect exports.
 */
export interface AudioTrack {
  id: AudioTrackId;
  name: string;
  color: string;
}

/**
 * Per-clip track assignment, keyed by the clip's stable `sourceKey`.
 */
export type AudioTrackAssignments = Record<string, AudioTrackId>;

/**
 * Per-clip timeline offset override in seconds, keyed by `sourceKey`.
 *
 * @remarks
 * Added to the clip's authored offset so the editor can nudge a clip along the
 * timeline (e.g. shift-drag to align audio to video) without editing scene
 * code. Applied in both preview and export so the alignment holds everywhere.
 */
export type AudioClipOffsets = Record<string, number>;

export function applyClipOffsets<
  T extends {
    sourceKey?: string;
    offset: number;
    gainEvents?: {time: number; gain: number}[];
  },
>(sounds: readonly T[], offsets: AudioClipOffsets): T[] {
  return sounds.map(sound => {
    const extra = sound.sourceKey ? offsets[sound.sourceKey] : undefined;
    if (!extra) {
      return sound;
    }
    // The gain envelope is anchored to the same timeline as the offset, so a
    // drag must move the envelope with the clip - otherwise a fade would stay
    // pinned to its old position and desync from the audio.
    const gainEvents = sound.gainEvents?.map(event => ({
      ...event,
      time: event.time + extra,
    }));
    return {...sound, offset: sound.offset + extra, gainEvents};
  });
}

export const DEFAULT_AUDIO_TRACK_COLOR = '#68abdf';

export function createDefaultAudioTracks(): AudioTrack[] {
  return [
    {
      id: PROJECT_AUDIO_TRACK_ID,
      name: 'Audio',
      color: DEFAULT_AUDIO_TRACK_COLOR,
    },
  ];
}

/**
 * Per-track preview mix.
 *
 * @remarks
 * There is deliberately no separate `muted` flag - a muted track is just one
 * at `volume: 0`, which keeps a single source of truth for "how loud is this
 * track" instead of two that can disagree.
 */
export interface AudioTrackMix {
  volume: number;
  solo: boolean;
}

export type AudioTrackMixMap = Record<AudioTrackId, AudioTrackMix>;

export interface ResolvedAudioMix {
  muted: boolean;
  volume: number;
}

export const DEFAULT_AUDIO_TRACK_MIX: AudioTrackMix = {
  volume: 1,
  solo: false,
};

/**
 * Sanitize a possibly-stale mix loaded from persisted player state.
 */
export function normalizeTrackMix(mix: unknown): AudioTrackMixMap {
  if (typeof mix !== 'object' || mix === null) {
    return {};
  }

  const normalized: AudioTrackMixMap = {};
  for (const [trackId, track] of Object.entries(
    mix as Record<string, unknown>,
  )) {
    if (typeof track !== 'object' || track === null) continue;
    const {volume, muted, solo} = track as Partial<AudioTrackMix> & {
      muted?: unknown;
    };
    const parsed =
      typeof volume === 'number' && !isNaN(volume) ? clamp(0, 1, volume) : 1;

    normalized[trackId] = {
      // Mixes persisted before `muted` was folded into `volume`.
      volume: muted === true ? 0 : parsed,
      solo: solo === true,
    };
  }

  return normalized;
}

/**
 * Resolve which timeline track a sound belongs to.
 *
 * @remarks
 * Media clips (a `Video`'s embedded audio) always live on the auto-populated
 * media lane. Project audio clips live on the track the editor assigned them
 * (looked up by `sourceKey`), falling back to the default project track.
 */
export function audioTrackIdForSound(
  sound: {sourceKey?: string; origin?: 'media' | 'audio'},
  assignments: AudioTrackAssignments = {},
  defaultTrackId: AudioTrackId = PROJECT_AUDIO_TRACK_ID,
): AudioTrackId {
  const origin = sound.origin ?? (sound.sourceKey ? 'media' : 'audio');
  if (origin === 'media') {
    return MEDIA_AUDIO_TRACK_ID;
  }
  if (sound.sourceKey && assignments[sound.sourceKey]) {
    return assignments[sound.sourceKey];
  }
  return defaultTrackId;
}

export function hasSoloedAudioTrack(mix: AudioTrackMixMap): boolean {
  return Object.values(mix).some(track => track.solo);
}

/**
 * Combine a track's own mix settings with the player-wide mute/volume.
 *
 * @remarks
 * Preview-only, same as the player-wide controls - exported output is
 * unaffected. Soloing any track silences every track that isn't soloed.
 */
export function resolveAudioMix(
  trackId: AudioTrackId,
  mix: AudioTrackMixMap,
  masterMuted: boolean,
  masterVolume: number,
): ResolvedAudioMix {
  const track = mix[trackId] ?? DEFAULT_AUDIO_TRACK_MIX;
  const silencedBySolo = hasSoloedAudioTrack(mix) && !track.solo;

  return {
    muted: masterMuted || silencedBySolo,
    volume: clamp(0, 1, masterVolume) * clamp(0, 1, track.volume),
  };
}
