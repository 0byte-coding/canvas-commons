import {
  Scene,
  Sound,
  SoundOrigin,
  trackPendingAudioAdjustment,
  useLogger,
  useMediaAudioAnalyzer,
  useScene,
} from '@canvas-commons/core';

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
