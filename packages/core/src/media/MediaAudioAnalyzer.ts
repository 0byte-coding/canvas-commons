import {useLogger, viaProxy} from '../utils';
import {
  computeNormalizeGainDb,
  measureIntegratedLufs,
  measureLoudPartLufs,
} from './loudness';

export type LoudnessNormalizeMode = 'integrated' | 'loudPart';

export interface LoudnessMeasurement {
  /** Integrated (whole-clip average) loudness in LUFS. */
  integratedLufs: number;
  /** "Loud part" reference loudness in LUFS, used for dynamics-preserving leveling. */
  loudPartLufs: number;
  /** Peak absolute sample amplitude across all channels, in range 0..1. */
  peakAmplitude: number;
}

interface DecodedAudio {
  channels: Float32Array[];
  sampleRate: number;
  peakAmplitude: number;
}

interface CacheEntry {
  /**
   * Decode + peak scan. Enough to answer {@link MediaAudioAnalyzer.hasAudio}
   * (whether a clip has audible audio) without paying for the much heavier
   * LUFS integration.
   */
  decoded: Promise<DecodedAudio | null>;
  /**
   * Full loudness measurement, computed lazily from {@link decoded} and only
   * when a caller actually needs LUFS values (i.e. normalization is enabled).
   * Deferring it keeps the common no-normalization path off the multi-second
   * LUFS integration that long clips would otherwise incur on every timeline
   * recalculation.
   */
  measurement?: Promise<LoudnessMeasurement | null>;
}

/**
 * Peak amplitude below which an audio track is treated as effectively silent
 * (no audible signal). Chosen well above typical dither/noise floors (~-90 dB)
 * but below any real content, so muxed-in silent audio tracks are ignored.
 */
const SILENCE_PEAK_THRESHOLD = 0.001;

/**
 * Decodes and measures the loudness of media audio sources, caching results
 * by source URL so repeated normalization requests (e.g. re-rendering the
 * same `Video` clip, or measuring it in both the editor and an export) don't
 * re-fetch/re-decode the file.
 */
export class MediaAudioAnalyzer {
  private readonly cache = new Map<string, CacheEntry>();
  private context: AudioContext | null = null;

  public constructor() {
    if (import.meta.hot) {
      import.meta.hot.on(
        'canvas-commons:assets',
        ({urls}: {urls: string[]}) => {
          for (const url of urls) {
            this.cache.delete(url);
          }
        },
      );
    }
  }

  /**
   * Measure the loudness of an audio source, using a cached result if
   * available.
   *
   * @param source - URL of the audio/video file to measure.
   * @returns `null` if the source has no decodable audio track.
   */
  public async measure(source: string): Promise<LoudnessMeasurement | null> {
    const entry = this.entryFor(source);
    entry.measurement ??= this.measureFrom(entry.decoded);
    return entry.measurement;
  }

  private entryFor(source: string): CacheEntry {
    let entry = this.cache.get(source);
    if (!entry) {
      entry = {decoded: this.decode(source)};
      this.cache.set(source, entry);
    }
    return entry;
  }

  private async measureFrom(
    decoded: Promise<DecodedAudio | null>,
  ): Promise<LoudnessMeasurement | null> {
    const audio = await decoded;
    if (!audio) {
      return null;
    }
    return {
      integratedLufs: measureIntegratedLufs(audio.channels, audio.sampleRate),
      loudPartLufs: measureLoudPartLufs(audio.channels, audio.sampleRate),
      peakAmplitude: audio.peakAmplitude,
    };
  }

  /**
   * Determine whether a source has an audible audio track.
   *
   * @remarks
   * Reuses the same decode cache as {@link measure}, so calling this before
   * measuring (or vice versa) does not decode the file twice.
   *
   * Returns `false` both when the source has no decodable audio track (e.g. a
   * video encoded without an audio stream) and when the track carries no
   * audible signal (e.g. a muxed-in silent audio stream), since neither
   * should produce a waveform in the timeline.
   *
   * @param source - URL of the audio/video file to inspect.
   */
  public async hasAudio(source: string): Promise<boolean> {
    const decoded = await this.entryFor(source).decoded;
    return decoded !== null && decoded.peakAmplitude >= SILENCE_PEAK_THRESHOLD;
  }

  /**
   * Compute the dB gain to apply to `source` so it reaches `targetLufs`.
   *
   * @param mode - `'integrated'` normalizes the whole clip's average
   * loudness flat to the target. `'loudPart'` instead references a
   * high-percentile short-term loudness value, preserving relative
   * dynamics between quiet and loud sections.
   * @returns `0` if the source has no measurable audio.
   */
  public async computeNormalizeGain(
    source: string,
    targetLufs: number,
    mode: LoudnessNormalizeMode = 'integrated',
  ): Promise<number> {
    const measurement = await this.measure(source);
    if (!measurement) {
      return 0;
    }
    const measuredLufs =
      mode === 'loudPart'
        ? measurement.loudPartLufs
        : measurement.integratedLufs;
    return computeNormalizeGainDb(measuredLufs, targetLufs);
  }

  private getContext(): AudioContext {
    this.context ??= new AudioContext();
    return this.context;
  }

  private async decode(source: string): Promise<DecodedAudio | null> {
    let response: Response;
    try {
      response = await fetch(viaProxy(source));
    } catch (e: any) {
      useLogger().warn({
        message: `Could not fetch audio for loudness analysis: "${source}".`,
        remarks: String(e),
      });
      return null;
    }
    if (!response.ok) {
      useLogger().warn(
        `Could not fetch audio for loudness analysis: "${source}" (${response.status}).`,
      );
      return null;
    }

    const buffer = await response.arrayBuffer();
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await this.getContext().decodeAudioData(buffer);
    } catch {
      // No decodable audio track (e.g. a video with no audio stream).
      return null;
    }

    const channels: Float32Array[] = [];
    let peakAmplitude = 0;
    for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
      const channel = audioBuffer.getChannelData(i);
      channels.push(channel);
      for (let s = 0; s < channel.length; s++) {
        const magnitude = Math.abs(channel[s]);
        if (magnitude > peakAmplitude) {
          peakAmplitude = magnitude;
        }
      }
    }

    return {channels, sampleRate: audioBuffer.sampleRate, peakAmplitude};
  }
}

let SharedAnalyzer: MediaAudioAnalyzer | null = null;

/**
 * Get the shared {@link MediaAudioAnalyzer} instance.
 *
 * @remarks
 * Shared across the whole app so loudness measurements (and their decode
 * cache) are reused between e.g. `Video` nodes and any UI that wants to
 * display a clip's measured LUFS.
 */
export function useMediaAudioAnalyzer(): MediaAudioAnalyzer {
  SharedAnalyzer ??= new MediaAudioAnalyzer();
  return SharedAnalyzer;
}
