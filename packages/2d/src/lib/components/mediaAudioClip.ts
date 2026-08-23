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
  gainTargets?: GainTargetEvent[];
  fadeIn?: number;
  fadeOut?: number;
}

export interface MediaAudioClipHandle {
  clip: Sound;
  scene: Scene;
  token: number;
}

export class MediaAudioClip {
  private handle: MediaAudioClipHandle | null = null;
  private measurementToken = 0;

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
    const token = ++this.measurementToken;
    this.handle = {clip, scene, token};

    const analyzer = useMediaAudioAnalyzer();
    const target = config.levelTo !== false ? config.levelTo : config.normalize;
    const mode = config.levelTo !== false ? 'loudPart' : 'integrated';

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

        if (config.gainTargets && config.gainTargets.length > 0) {
          const events = await this.resolveGainEvents(
            analyzer,
            config.audio,
            config.gainTargets,
          );
          if (this.handle?.clip === clip && this.handle.token === token) {
            clip.gainEvents = events;
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
        if (this.handle?.clip === clip && this.handle.token === token) {
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

  private async resolveGainEvents(
    analyzer: ReturnType<typeof useMediaAudioAnalyzer>,
    audio: string,
    targets: GainTargetEvent[],
  ): Promise<GainEvent[]> {
    // computeNormalizeGain is linear in the target LUFS, so measure a single
    // reference offset per mode (gain at target 0) and add the per-event target.
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

  /**
   * Close off the in-progress clip.
   *
   * @param resolveEndTime - Resolves the timeline position to stop the clip at.
   * A clip covering no duration is discarded.
   */
  public finalize(resolveEndTime: () => number): void {
    this.measurementToken++;
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
    this.measurementToken++;
    this.handle = null;
  }
}
