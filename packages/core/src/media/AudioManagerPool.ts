import {Logger} from '../app';
import {Sound} from '../scenes';
import {AudioManager} from './AudioManager';
import {AudioResourceManager} from './AudioResourceManager';
import {
  AudioTrackAssignments,
  AudioTrackId,
  AudioTrackMixMap,
  PROJECT_AUDIO_TRACK_ID,
  audioTrackIdForSound,
  resolveAudioMix,
} from './trackMix';

export class AudioManagerPool {
  private readonly context = new AudioContext();

  private pool: AudioManager[] = [];
  private managers: Map<Sound, AudioManager> = new Map();
  private sounds: Sound[] = [];

  private muted: boolean = true;
  private volume: number = 1;
  private paused: boolean = true;
  private trackMix: AudioTrackMixMap = {};
  private trackAssignments: AudioTrackAssignments = {};
  private defaultTrackId: AudioTrackId = PROJECT_AUDIO_TRACK_ID;

  public constructor(
    private readonly logger: Logger,
    private readonly audioResources: AudioResourceManager,
  ) {}

  public async setupPool(sounds: Sound[]) {
    for (const manager of this.pool) {
      manager.dispose();
    }
    this.pool = [];
    for (const manager of this.managers.values()) {
      manager.dispose();
    }
    this.managers.clear();
    this.sounds = sounds;
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
    this.applyMix();
  }

  public setVolume(volume: number) {
    this.volume = volume;
    this.applyMix();
  }

  public setTrackMix(trackMix: AudioTrackMixMap) {
    this.trackMix = trackMix;
    this.applyMix();
  }

  public setTrackAssignments(
    assignments: AudioTrackAssignments,
    defaultTrackId: AudioTrackId = PROJECT_AUDIO_TRACK_ID,
  ) {
    this.trackAssignments = assignments;
    this.defaultTrackId = defaultTrackId;
    this.applyMix();
  }

  private mixFor(sound: Sound) {
    return resolveAudioMix(
      audioTrackIdForSound(sound, this.trackAssignments, this.defaultTrackId),
      this.trackMix,
      this.muted,
      this.volume,
    );
  }

  private applyMix() {
    this.managers.forEach((manager, sound) => {
      const {muted, volume} = this.mixFor(sound);
      manager.setMuted(muted);
      manager.setVolume(volume);
    });
  }

  public setTime(time: number) {
    this.managers.forEach(manager => manager.setTime(time));
  }

  public async setPaused(paused: boolean) {
    this.paused = paused;
    await Promise.all(
      Array.from(this.managers.values()).map(manager =>
        manager.setPaused(paused),
      ),
    );
  }

  private isInRange(sound: Sound, time: number) {
    const duration = this.audioResources.peekDuration(sound.audio);
    const audioStart = sound.start ?? 0;
    const audioEnd = Math.min(duration, sound.end ?? Infinity);
    const audioDuration = (audioEnd - audioStart) / sound.realPlaybackRate;

    return time >= sound.offset && time < sound.offset + audioDuration;
  }

  public prepare(time: number) {
    for (const sound of this.sounds) {
      if (this.isInRange(sound, time)) {
        let manager = this.managers.get(sound);
        if (manager) continue;

        // sound is starting
        const {muted, volume} = this.mixFor(sound);
        manager = this.pool.pop() ?? this.spawn();
        manager.setSound(sound);
        manager.setMuted(muted);
        manager.setVolume(volume);
        manager.setTime(time);
        manager.setPaused(this.paused);
        manager.updateFade(time);
        this.managers.set(sound, manager);
      } else {
        const manager = this.managers.get(sound);
        if (!manager) continue;

        // sound has ended
        manager.setPaused(true);
        this.pool.push(manager);
        this.managers.delete(sound);
      }
    }

    this.managers.forEach(manager => manager.updateFade(time));
  }

  public spawn() {
    return new AudioManager(this.logger, this.context);
  }

  public resume() {
    if (this.context.state === 'suspended') {
      this.context.resume();
    }
  }
}
