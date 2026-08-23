import {
  GainEvent,
  Scene,
  Sound,
  SoundOrigin,
  gainToDb,
  trackPendingAudioAdjustment,
  useLogger,
  useMediaAudioAnalyzer,
  useScene,
} from '@canvas-commons/core';

export type GainTargetMode = 'volume' | 'levelTo' | 'normalize';

export interface GainTargetEvent {
  time: number;
  target: number;
  mode: GainTargetMode;
}

export interface MediaAudioClipConfig {
  audio: string;
  start: number;
  gain: number;
  playbackRate: number;
  sourceKey: string;
  origin: SoundOrigin;
  normalize: number | false;
  levelTo: number | false;
  fadeIn?: number;
  fadeOut?: number;
}

/**
 * Resolve time-varying gain target keyframes into an absolute dB envelope.
 *
 * @remarks
 * `volume` targets are already absolute dB. `levelTo`/`normalize` targets are
 * LUFS values; since {@link MediaAudioAnalyzer.computeNormalizeGain} is linear
 * in the target, a single reference gain (measured at target `0`) is reused per
 * mode and offset by each event's target. Events are returned sorted by time.
 *
 * @param analyzer - The loudness analyzer used to measure the reference gain.
 * @param audio - The source url to measure.
 * @param targets - The recorded gain keyframes.
 */
export async function resolveGainEvents(
  analyzer: ReturnType<typeof useMediaAudioAnalyzer>,
  audio: string,
  targets: GainTargetEvent[],
): Promise<GainEvent[]> {
  let loudPartRef: number | undefined;
  let integratedRef: number | undefined;

  const resolveGain = async (event: GainTargetEvent): Promise<number> => {
    switch (event.mode) {
      case 'volume':
        return gainToDb(event.target);
      case 'levelTo':
        loudPartRef ??= await analyzer.computeNormalizeGain(
          audio,
          0,
          'loudPart',
        );
        return loudPartRef + event.target;
      case 'normalize':
        integratedRef ??= await analyzer.computeNormalizeGain(
          audio,
          0,
          'integrated',
        );
        return integratedRef + event.target;
    }
  };

  const events: GainEvent[] = [];
  for (const target of targets) {
    events.push({time: target.time, gain: await resolveGain(target)});
  }
  events.sort((a, b) => a.time - b.time);
  return events;
}

export interface MediaAudioClipHandle {
  clip: Sound;
  scene: Scene;
  token: number;
}

export class MediaAudioClip {
  private handle: MediaAudioClipHandle | null = null;
  private registrationToken = 0;

  public register(config: MediaAudioClipConfig): void {
    const scene = useScene();
    const clip = scene.sounds.add(
      {
        audio: config.audio,
        start: config.start,
        gain: config.gain,
        playbackRate: config.playbackRate,
        sourceKey: config.sourceKey,
        origin: config.origin,
        fadeIn: config.fadeIn,
        fadeOut: config.fadeOut,
      },
      0,
    );
    const token = ++this.registrationToken;
    this.handle = {clip, scene, token};

    const analyzer = useMediaAudioAnalyzer();
    const target = config.levelTo !== false ? config.levelTo : config.normalize;
    const mode = config.levelTo !== false ? 'loudPart' : 'integrated';

    // The clip stays in the scene after finalize/release (it represents the
    // whole file), so a still-pending measurement must still land on it. Only a
    // newer registration of THIS instance supersedes it - tracked by comparing
    // the captured registration token against the latest one.
    const superseded = () => token !== this.registrationToken;

    const adjustment = analyzer
      .hasAudio(config.audio)
      .then(async hasAudio => {
        if (!hasAudio) {
          scene.sounds.remove(clip);
          if (this.handle?.clip === clip) {
            this.handle = null;
          }
          return;
        }

        if (target === false) {
          return;
        }

        const gainDb = await analyzer.computeNormalizeGain(
          config.audio,
          target,
          mode,
        );
        if (!superseded()) {
          clip.gain = gainDb;
        }
      })
      .catch(e => {
        useLogger().warn({
          message: `Could not analyze audio for "${config.audio}".`,
          remarks: String(e),
          inspect: config.sourceKey,
        });
      });
    trackPendingAudioAdjustment(adjustment);
  }

  /**
   * Resolve a recorded gain envelope for the current clip and apply it as an
   * absolute per-frame gain (in dB).
   *
   * @remarks
   * Kicked off by the `fade*To` generators once they have finished recording
   * the envelope, so the keyframes are complete. Tracked as a pending audio
   * adjustment so the player/renderer waits for it before snapshotting sounds.
   */
  public applyGainEnvelope(targets: GainTargetEvent[]): void {
    const handle = this.handle;
    if (!handle || targets.length === 0) {
      return;
    }
    const {clip, token} = handle;
    const analyzer = useMediaAudioAnalyzer();
    const audio = clip.audio;
    const adjustment = resolveGainEvents(analyzer, audio, targets)
      .then(events => {
        if (token === this.registrationToken) {
          clip.gainEvents = events;
        }
      })
      .catch(e => {
        useLogger().warn({
          message: `Could not resolve gain envelope for "${audio}".`,
          remarks: String(e),
        });
      });
    trackPendingAudioAdjustment(adjustment);
  }

  /**
   * Close off the in-progress clip.
   *
   * @param resolveEndTime - Resolves the timeline position to stop the clip at.
   * A clip covering no duration is discarded.
   */
  public finalize(resolveEndTime: () => number): void {
    const handle = this.handle;
    if (!handle) {
      return;
    }
    this.handle = null;

    const endTime = resolveEndTime();
    if (endTime <= (handle.clip.start ?? 0)) {
      handle.scene.sounds.remove(handle.clip);
      return;
    }
    handle.clip.end = endTime;
  }

  /**
   * Drop the reference to the in-progress clip without truncating it, leaving
   * its `end` untouched so it plays/draws to the source's natural end.
   *
   * @remarks
   * Used by clips that represent a whole audio file (the `Audio` node): tearing
   * the node down for a recalculation must not shorten the clip to wherever the
   * playhead happened to be.
   */
  public release(): void {
    this.handle = null;
  }
}
