import {
  DependencyContext,
  SerializedVector2,
  SignalValue,
  SimpleSignal,
  ThreadGenerator,
  TimingFunction,
  clamp,
  gainToDb,
  linear,
  tween,
  usePlayback,
  useThread,
} from '@canvas-commons/core';
import {computed, initial, nodeName, signal} from '../decorators';
import {DesiredLength} from '../partials';
import {MediaAudioClip} from './mediaAudioClip';
// Extends Rect (like Video) rather than Node directly: it inherits the same
// module-load chain, avoiding the Node<->Layout import cycle that breaks when a
// Node-extending component is evaluated first in the barrel. Audio draws
// nothing and reports zero size, so the visual props are inert.
import {Rect, RectProps} from './Rect';

export interface AudioProps extends RectProps {
  /**
   * {@inheritDoc Audio.src}
   */
  src?: SignalValue<string>;
  /**
   * {@inheritDoc Audio.loop}
   */
  loop?: SignalValue<boolean>;
  /**
   * {@inheritDoc Audio.playbackRate}
   */
  playbackRate?: number;
  /**
   * The starting time for this audio in seconds.
   */
  time?: SignalValue<number>;
  play?: boolean;
  /**
   * {@inheritDoc Audio.volume}
   */
  volume?: SignalValue<number>;
  /**
   * {@inheritDoc Audio.normalize}
   */
  normalize?: SignalValue<number | false>;
  /**
   * {@inheritDoc Audio.levelTo}
   */
  levelTo?: SignalValue<number | false>;
  /**
   * {@inheritDoc Audio.fadeIn}
   */
  fadeIn?: SignalValue<number>;
  /**
   * {@inheritDoc Audio.fadeOut}
   */
  fadeOut?: SignalValue<number>;
}

/**
 * Which gain mode a recorded keyframe was authored in.
 *
 * @remarks
 * `volume` values are absolute dB and need no measurement. `levelTo`/`normalize`
 * values are LUFS targets and are offset by the source's measured loudness at
 * registration time to become an absolute gain.
 */
type GainMode = 'volume' | 'levelTo' | 'normalize';

interface GainTargetEvent {
  time: number;
  target: number;
  mode: GainMode;
}

@nodeName('Audio')
export class Audio extends Rect {
  private static readonly pool: Record<string, HTMLAudioElement> = {};

  /**
   * The source of this audio.
   *
   * @example
   * ```tsx
   * import audio from './example.mp3';
   * // ...
   * view.add(<Audio src={audio} play />)
   * ```
   */
  @signal()
  declare public readonly src: SimpleSignal<string, this>;

  /**
   * Whether this audio should loop upon reaching the end.
   */
  @initial(false)
  @signal()
  declare public readonly loop: SimpleSignal<boolean, this>;

  /**
   * The rate at which the audio plays, as multiples of the normal speed.
   *
   * @defaultValue 1
   */
  @initial(1)
  @signal()
  declare public readonly playbackRate: SimpleSignal<number, this>;

  /**
   * The volume of this audio.
   *
   * @remarks
   * `1` plays the source audio unmodified. Applies during both live preview
   * and export.
   *
   * @defaultValue 1
   */
  @initial(1)
  @signal()
  declare public readonly volume: SimpleSignal<number, this>;

  /**
   * Normalize this audio to a target LUFS, flattening the whole clip's
   * average loudness to that target.
   *
   * @remarks
   * Overrides {@link volume}. Set to `false` to disable. Measured once per
   * source and cached; see {@link levelTo} to preserve loud/quiet dynamics
   * instead of flattening them.
   *
   * @defaultValue false
   */
  @initial(false)
  @signal()
  declare public readonly normalize: SimpleSignal<number | false, this>;

  /**
   * Level this audio to a target LUFS using a "loud part" reference instead
   * of the whole clip's average, preserving relative dynamics between quiet
   * and loud sections.
   *
   * @remarks
   * Overrides {@link volume} and {@link normalize}. Set to `false` to
   * disable. Measured once per source and cached.
   *
   * @defaultValue false
   */
  @initial(false)
  @signal()
  declare public readonly levelTo: SimpleSignal<number | false, this>;

  /**
   * Fade this audio in from silence over the given number of seconds at its
   * start.
   *
   * @defaultValue 0
   */
  @initial(0)
  @signal()
  declare public readonly fadeIn: SimpleSignal<number, this>;

  /**
   * Fade this audio out to silence over the given number of seconds at its
   * end.
   *
   * @defaultValue 0
   */
  @initial(0)
  @signal()
  declare public readonly fadeOut: SimpleSignal<number, this>;

  @initial(0)
  @signal()
  declare protected readonly time: SimpleSignal<number, this>;

  @initial(false)
  @signal()
  declare protected readonly playing: SimpleSignal<boolean, this>;

  private lastTime = -1;
  private readonly audio = new MediaAudioClip();
  private gainTargetEvents: GainTargetEvent[] = [];

  public constructor({play, ...props}: AudioProps) {
    super(props);
    if (play) {
      this.play();
    }
  }

  public isPlaying(): boolean {
    return this.playing();
  }

  public getCurrentTime(): number {
    return this.clampTime(this.time());
  }

  public getDuration(): number {
    return this.element().duration;
  }

  /**
   * Smoothly animate {@link levelTo} to a new target LUFS over time.
   *
   * @remarks
   * Records a gain envelope so the transition is applied per frame in both the
   * live preview and the export, on a single `Audio` node - no need to
   * crossfade two clips. Preserves the level-based loudness normalization.
   *
   * @param target - The target loudness in LUFS.
   * @param duration - Duration of the ramp in seconds.
   * @param timing - Timing function for the ramp. Defaults to linear.
   */
  public *fadeLevelTo(
    target: number,
    duration: number,
    timing: TimingFunction = linear,
  ): ThreadGenerator {
    yield* this.animateGainTarget(
      'levelTo',
      this.levelTo,
      target,
      duration,
      timing,
    );
  }

  /**
   * Smoothly animate {@link normalize} to a new target LUFS over time.
   *
   * @param target - The target loudness in LUFS.
   * @param duration - Duration of the ramp in seconds.
   * @param timing - Timing function for the ramp. Defaults to linear.
   */
  public *fadeNormalizeTo(
    target: number,
    duration: number,
    timing: TimingFunction = linear,
  ): ThreadGenerator {
    yield* this.animateGainTarget(
      'normalize',
      this.normalize,
      target,
      duration,
      timing,
    );
  }

  /**
   * Smoothly animate {@link volume} to a new value over time, recording the
   * change as a per-frame gain envelope.
   *
   * @param target - The target linear volume (`1` is unchanged).
   * @param duration - Duration of the ramp in seconds.
   * @param timing - Timing function for the ramp. Defaults to linear.
   */
  public *fadeVolumeTo(
    target: number,
    duration: number,
    timing: TimingFunction = linear,
  ): ThreadGenerator {
    yield* this.animateGainTarget(
      'volume',
      this.volume,
      target,
      duration,
      timing,
    );
  }

  private *animateGainTarget(
    mode: GainMode,
    signal: SimpleSignal<number | false, this> | SimpleSignal<number, this>,
    target: number,
    duration: number,
    timing: TimingFunction,
  ): ThreadGenerator {
    const thread = useThread();
    // Gain events are sampled against the global playback clock (the same base
    // as the clip's offset), but the thread runs on a scene-local clock that
    // restarts at zero every scene. Rebase local time by the scene's global
    // start so a swell in a later scene lands at the right moment instead of
    // being read entirely past its end (stuck at the final, loud value).
    const sceneBase = usePlayback().time - thread.time();
    const now = () => sceneBase + thread.time();
    const from =
      (signal() as number | false) === false ? target : (signal() as number);
    this.recordGainTarget(mode, from, now());
    yield* tween(duration, value => {
      const eased = timing(value);
      const current = from + (target - from) * eased;
      (signal as SimpleSignal<number, this>)(current);
      this.recordGainTarget(mode, current, now());
    });
    (signal as SimpleSignal<number, this>)(target);
    this.recordGainTarget(mode, target, now());
    // The keyframes are now complete, so resolve them into an absolute gain
    // envelope on the current clip. Kicked off here (not at play()) so the
    // async loudness measurement reads a fully-recorded envelope.
    this.audio.applyGainEnvelope([...this.gainTargetEvents]);
  }

  private recordGainTarget(mode: GainMode, target: number, time: number): void {
    const last = this.gainTargetEvents[this.gainTargetEvents.length - 1];
    if (last && last.time === time) {
      last.target = target;
      last.mode = mode;
      return;
    }
    this.gainTargetEvents.push({mode, target, time});
  }

  protected override desiredSize(): SerializedVector2<DesiredLength> {
    return {x: 0, y: 0};
  }

  protected override draw(): void {}

  @computed()
  protected element(): HTMLAudioElement {
    const src = this.src();
    const key = `${this.key}/${src}`;
    let element = Audio.pool[key];
    if (!element) {
      element = document.createElement('audio');
      element.src = src;
      element.volume = 0;
      element.muted = true;
      Audio.pool[key] = element;
    }

    if (element.readyState < 1) {
      DependencyContext.collectPromise(
        new Promise<void>(resolve => {
          const listener = () => {
            resolve();
            element.removeEventListener('loadedmetadata', listener);
          };
          element.addEventListener('loadedmetadata', listener);
        }),
      );
    }

    return element;
  }

  public clampTime(time: number): number {
    const duration = this.element().duration;
    if (!isFinite(duration)) {
      return Math.max(0, time);
    }
    if (this.loop()) {
      time %= duration;
    }
    return clamp(0, duration, time);
  }

  private currentTimeSafely(): number {
    const rawTime = DependencyContext.collectingPromisesSuppressed(() =>
      this.time(),
    );
    const time = isFinite(rawTime) ? rawTime : Math.max(0, this.lastTime);
    const duration = Audio.pool[`${this.key}/${this.src()}`]?.duration;
    if (!duration || !isFinite(duration)) {
      return Math.max(0, time);
    }
    return clamp(0, duration, this.loop() ? time % duration : time);
  }

  public play(): void {
    const time = useThread().time;
    const start = time();
    const offset = this.time();
    const playbackRate = this.playbackRate();
    this.playing(true);
    this.time(() => this.clampTime(offset + (time() - start) * playbackRate));
    this.registerAudioClip(offset);
  }

  public pause(): void {
    this.playing(false);
    this.time.save();
    this.finalizeAudioClip();
  }

  public seek(time: number): void {
    const playing = this.playing();
    this.finalizeAudioClip();
    this.time(this.clampTime(time));
    if (playing) {
      this.play();
    } else {
      this.pause();
    }
  }

  private registerAudioClip(startTime: number): void {
    // A still-playing clip is released rather than finalized: it represents the
    // whole file, so tearing it down (e.g. on recalculation) must not truncate
    // its `end` to the current playhead. Explicit pause/seek still finalize.
    this.audio.release();
    this.audio.register({
      audio: this.src(),
      start: startTime,
      gain: gainToDb(this.volume()),
      playbackRate: this.playbackRate(),
      sourceKey: this.key,
      origin: 'audio',
      normalize: this.normalize(),
      levelTo: this.levelTo(),
      fadeIn: this.fadeIn(),
      fadeOut: this.fadeOut(),
    });
  }

  private finalizeAudioClip(): void {
    this.audio.finalize(() => this.currentTimeSafely());
  }

  public override dispose(): void {
    this.audio.release();
    super.dispose();
  }
}
