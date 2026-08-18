import {
  AudioTrack,
  AudioTrackAssignments,
  DEFAULT_AUDIO_TRACK_COLOR,
  PROJECT_AUDIO_TRACK_ID,
} from '@canvas-commons/core';
import {useCallback} from 'preact/hooks';
import {useApplication} from '../../contexts';
import {useSharedSettings} from '../../hooks';

const TRACK_COLORS = [
  '#68abdf',
  '#e0a458',
  '#9bc995',
  '#d98b9e',
  '#b18fd0',
  '#5ec4c4',
];

function createTrackId(): string {
  return `track-${Math.random().toString(36).slice(2, 9)}`;
}

export interface UseAudioTracks {
  tracks: AudioTrack[];
  assignments: AudioTrackAssignments;
  addTrack: () => void;
  renameTrack: (id: string, name: string) => void;
  recolorTrack: (id: string, color: string) => void;
  removeTrack: (id: string) => void;
  moveTrack: (id: string, direction: -1 | 1) => void;
  reorderTrack: (id: string, targetId: string) => void;
  assignClip: (sourceKey: string, trackId: string) => void;
}

export function useAudioTracks(): UseAudioTracks {
  const {meta} = useApplication();
  const settings = useSharedSettings();
  const tracks = settings.audioTracks ?? [];
  const assignments = settings.audioTrackAssignments ?? {};

  const setTracks = useCallback(
    (next: AudioTrack[]) => meta.shared.audioTracks.set(next),
    [meta],
  );
  const setAssignments = useCallback(
    (next: AudioTrackAssignments) =>
      meta.shared.audioTrackAssignments.set(next),
    [meta],
  );

  const addTrack = useCallback(() => {
    const color = TRACK_COLORS[tracks.length % TRACK_COLORS.length];
    setTracks([
      ...tracks,
      {
        id: createTrackId(),
        name: `Audio ${tracks.length + 1}`,
        color: color ?? DEFAULT_AUDIO_TRACK_COLOR,
      },
    ]);
  }, [tracks, setTracks]);

  const renameTrack = useCallback(
    (id: string, name: string) => {
      setTracks(
        tracks.map(track => (track.id === id ? {...track, name} : track)),
      );
    },
    [tracks, setTracks],
  );

  const recolorTrack = useCallback(
    (id: string, color: string) => {
      setTracks(
        tracks.map(track => (track.id === id ? {...track, color} : track)),
      );
    },
    [tracks, setTracks],
  );

  const removeTrack = useCallback(
    (id: string) => {
      if (tracks.length <= 1) return;
      const remaining = tracks.filter(track => track.id !== id);
      const fallback = remaining[0]?.id ?? PROJECT_AUDIO_TRACK_ID;
      const nextAssignments: AudioTrackAssignments = {};
      for (const [key, trackId] of Object.entries(assignments)) {
        nextAssignments[key] = trackId === id ? fallback : trackId;
      }
      setTracks(remaining);
      setAssignments(nextAssignments);
    },
    [tracks, assignments, setTracks, setAssignments],
  );

  const moveTrack = useCallback(
    (id: string, direction: -1 | 1) => {
      const index = tracks.findIndex(track => track.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= tracks.length) return;
      const next = [...tracks];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      setTracks(next);
    },
    [tracks, setTracks],
  );

  const reorderTrack = useCallback(
    (id: string, targetId: string) => {
      if (id === targetId) return;
      const from = tracks.findIndex(track => track.id === id);
      const to = tracks.findIndex(track => track.id === targetId);
      if (from < 0 || to < 0) return;
      const next = [...tracks];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      setTracks(next);
    },
    [tracks, setTracks],
  );

  const assignClip = useCallback(
    (sourceKey: string, trackId: string) => {
      if (assignments[sourceKey] === trackId) return;
      setAssignments({...assignments, [sourceKey]: trackId});
    },
    [assignments, setAssignments],
  );

  return {
    tracks,
    assignments,
    addTrack,
    renameTrack,
    recolorTrack,
    removeTrack,
    moveTrack,
    reorderTrack,
    assignClip,
  };
}

/**
 * Resolve which project track a sound sits on, honoring editor assignments
 * and falling back to the first track.
 */
export function resolveClipTrackId(
  sourceKey: string | undefined,
  assignments: AudioTrackAssignments,
  tracks: {id: string}[],
): string {
  const fallback = tracks[0]?.id ?? PROJECT_AUDIO_TRACK_ID;
  if (sourceKey && assignments[sourceKey]) {
    const assigned = assignments[sourceKey];
    return tracks.some(track => track.id === assigned) ? assigned : fallback;
  }
  return fallback;
}
