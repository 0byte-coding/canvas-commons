import {
  DependencyContext,
  SerializedVector2,
  SignalValue,
  SimpleSignal,
  clamp,
  gainToDb,
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

  @initial(0)
  @signal()
  declare protected readonly time: SimpleSignal<number, this>;

  @initial(false)
  @signal()
  declare protected readonly playing: SimpleSignal<boolean, this>;

  private lastTime = -1;
  private readonly audio = new MediaAudioClip();

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
    this.finalizeAudioClip();
    this.audio.register({
      audio: this.src(),
      start: startTime,
      gain: gainToDb(this.volume()),
      playbackRate: this.playbackRate(),
      sourceKey: this.key,
      origin: 'audio',
      normalize: this.normalize(),
      levelTo: this.levelTo(),
    });
  }

  private finalizeAudioClip(): void {
    this.audio.finalize(() => this.currentTimeSafely());
  }

  public override dispose(): void {
    this.finalizeAudioClip();
    super.dispose();
  }
}
