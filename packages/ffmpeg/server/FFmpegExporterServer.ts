import type {
  RendererResult,
  RendererSettings,
  Sound,
} from '@canvas-commons/core';
import type {PluginConfig} from '@canvas-commons/vite-plugin';
import {ffmpegPath, ffprobePath} from 'ffmpeg-ffprobe-static';
import type {AudioVideoFilter, FilterSpecification} from 'fluent-ffmpeg';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as path from 'path';
import {Readable} from 'stream';
import {buildGainVolumeExpression} from './gainVolumeExpression';
import {ImageStream} from './ImageStream';

ffmpeg.setFfmpegPath(ffmpegPath!);
ffmpeg.setFfprobePath(ffprobePath!);

export interface FFmpegExporterSettings extends RendererSettings {
  audio?: string;
  audioOffset?: number;

  sounds: Sound[];
  duration: number;

  fastStart: boolean;
  audioOnly: boolean;
  includeAudio: boolean;
  audioSampleRate: number;
}

function formatFilters(filters: AudioVideoFilter[]): string {
  return filters
    .map(f => {
      let options: string[] = [];
      if (typeof f.options === 'string') {
        options = [f.options];
      } else if (f.options.constructor === Array) {
        options = f.options;
      } else {
        options = Object.entries(f.options)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k}=${v}`);
      }
      return `${f.filter}=${options.join(':')}`;
    })
    .join(',');
}

/**
 * The server-side implementation of the FFmpeg video exporter.
 */
export class FFmpegExporterServer {
  private readonly stream: ImageStream;
  private readonly command: ffmpeg.FfmpegCommand;
  private readonly promise: Promise<void>;
  private readonly audioOnly: boolean;

  public constructor(
    settings: FFmpegExporterSettings,
    private readonly config: PluginConfig,
  ) {
    const size = {
      x: Math.round(settings.size.x * settings.resolutionScale),
      y: Math.round(settings.size.y * settings.resolutionScale),
    };
    this.stream = new ImageStream(size);
    this.command = ffmpeg();

    const audioOnly = settings.audioOnly === true;
    this.audioOnly = audioOnly;

    // Input image sequence. Skipped for audio-only exports, where no frames are
    // rendered at all; this also shifts the audio inputs down to start at 0.
    if (!audioOnly) {
      this.command
        .input(this.stream)
        .inputFormat('rawvideo')
        .inputOptions(['-pix_fmt rgba', '-s:v', `${size.x}x${size.y}`])
        .inputFps(settings.fps);
    }
    const audioInputBase = audioOnly ? 0 : 1;

    // Input audio
    const sounds = [...settings.sounds];
    if (settings.audio && settings.includeAudio) {
      sounds.push({
        audio: settings.audio,
        realPlaybackRate: 1,
        offset: settings.audioOffset ?? 0,
      });
    }

    const filterSpec: FilterSpecification[] = [];
    const streams: string[] = [];

    for (let i = 0; i < sounds.length; i++) {
      const sound = sounds[i];
      this.command.input(this.resolveAudioPath(sound.audio));

      let trimmed = sound.start ?? 0;
      if (sound.offset < 0) {
        trimmed -= sound.offset * sound.realPlaybackRate;
      }

      if (trimmed !== 0) {
        this.command.inputOptions(`-ss ${trimmed}`);
      }

      const filters: AudioVideoFilter[] = [];
      if (sound.end !== undefined) {
        filters.push({
          filter: 'atrim',
          options: {end: sound.end - trimmed},
        });
      }

      filters.push({
        filter: 'aresample',
        options: settings.audioSampleRate.toString(),
      });

      // Fades run before asetrate/adelay, so their positions are in source
      // seconds. The user specifies fades in scene (wall-clock) seconds, so
      // scale by the playback rate.
      const rate = sound.realPlaybackRate;

      if (sound.gainEvents && sound.gainEvents.length > 0) {
        // A time-varying gain envelope: convert each scene-time keyframe into a
        // source-relative time (matching where this volume filter sits in the
        // chain, before asetrate/adelay) and emit a per-sample expression.
        const expr = buildGainVolumeExpression(
          sound.gainEvents,
          sound.offset,
          rate,
        );
        filters.push({
          filter: 'volume',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          options: {volume: expr, eval: 'frame'},
        });
      } else if (sound.gain) {
        filters.push({
          filter: 'volume',
          options: {volume: `${sound.gain}dB`},
        });
      }
      const fadeIn = (sound.fadeIn ?? 0) * rate;
      const fadeOut = (sound.fadeOut ?? 0) * rate;
      if (fadeIn > 0) {
        filters.push({
          filter: 'afade',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          options: {t: 'in', st: 0, d: fadeIn},
        });
      }
      if (fadeOut > 0) {
        // Source-timeline length of the clip. With an explicit end use it;
        // otherwise the sound plays until the scene ends, so anchor the fade to
        // the scene's output duration relative to where the clip starts.
        const sceneEnd = settings.duration / settings.fps;
        const clipDuration =
          sound.end !== undefined
            ? sound.end - trimmed
            : (sceneEnd - Math.max(0, sound.offset)) * rate;
        const start = Math.max(0, clipDuration - fadeOut);
        filters.push({
          filter: 'afade',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          options: {t: 'out', st: start, d: fadeOut},
        });
      }

      if (sound.realPlaybackRate !== 1) {
        const rate = Math.round(
          settings.audioSampleRate * sound.realPlaybackRate,
        );
        filters.push({
          filter: 'asetrate',
          options: {r: rate},
        });
        filters.push({
          filter: 'aresample',
          options: settings.audioSampleRate.toString(),
        });
      }

      if (sound.offset > 0) {
        const delay = Math.round(sound.offset * 1000);
        filters.push({
          filter: 'adelay',
          options: {delays: delay, all: 1},
        });
      }

      const inputIndex = i + audioInputBase;
      if (filters.length > 0) {
        filterSpec.push({
          inputs: `${inputIndex}:a`,
          filter: formatFilters(filters),
          outputs: `a${inputIndex}`,
        });
        streams.push(`a${inputIndex}`);
      } else {
        streams.push(`${inputIndex}:a`);
      }
    }

    if (sounds.length > 0) {
      this.command.complexFilter([
        ...filterSpec,
        {
          filter: 'amix',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          options: {inputs: sounds.length, dropout_transition: 0, normalize: 0},
          inputs: streams,
          outputs: 'a',
        },
      ]);
      this.command.outputOptions(
        audioOnly ? ['-map [a]'] : ['-map 0:v', '-map [a]'],
      );
    }

    const duration = settings.duration / settings.fps;
    if (audioOnly) {
      // Audio-only output: a standalone track capped at the scene duration.
      this.command
        .output(path.join(this.config.output, `${settings.name}.m4a`))
        .outputOptions(['-vn', `-t ${duration}`]);
      if (settings.fastStart) {
        this.command.outputOptions(['-movflags +faststart']);
      }
    } else {
      // Output settings
      this.command
        .output(path.join(this.config.output, `${settings.name}.mp4`))
        .outputOptions(['-pix_fmt yuv420p', `-t ${duration}`])
        .outputFps(settings.fps)
        .size(`${size.x}x${size.y}`);
      if (settings.fastStart) {
        this.command.outputOptions(['-movflags +faststart']);
      }
    }

    this.promise = new Promise<void>((resolve, reject) => {
      this.command.on('end', () => resolve()).on('error', reject);
    });
  }

  // Resolve an audio asset URL to a real filesystem path. Assets imported by
  // absolute path (outside the Vite root) are served under `/@fs/`; everything
  // else is a project-relative URL.
  private resolveAudioPath(url: string): string {
    const clean = url.split('?')[0];
    if (clean.startsWith('/@fs/')) {
      return decodeURIComponent(clean.slice('/@fs'.length));
    }
    return decodeURIComponent(clean.slice(1));
  }

  public async start() {
    if (!fs.existsSync(this.config.output)) {
      await fs.promises.mkdir(this.config.output, {recursive: true});
    }
    this.command.on('stderr', console.error);
    this.command.run();
  }

  public async handleFrame(req: Readable) {
    await this.stream.pushImage(req);
  }

  public async end(result: RendererResult) {
    if (!this.audioOnly) {
      this.stream.pushImage(null);
    }
    if (result === 1) {
      try {
        this.command.kill('SIGKILL');
        await this.promise;
      } catch (_) {
        // do nothing
      }
    } else {
      await this.promise;
    }
  }
}
