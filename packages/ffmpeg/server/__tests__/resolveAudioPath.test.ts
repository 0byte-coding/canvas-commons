import {describe, expect, it} from 'vitest';
import {resolveAudioPath} from '../resolveAudioPath';

describe('resolveAudioPath()', () => {
  it('passes a remote https url through unchanged', () => {
    const url = 'https://i.imgflip.com/6qyam6.mp4';
    expect(resolveAudioPath(url)).toBe(url);
  });

  it('passes a remote http url through unchanged', () => {
    const url = 'http://example.com/clip.mp4';
    expect(resolveAudioPath(url)).toBe(url);
  });

  it('does not mangle the protocol of a remote url', () => {
    // Regression: slicing the leading '/' turned https:// into ttps://.
    expect(resolveAudioPath('https://i.imgflip.com/x.mp4')).toMatch(
      /^https:\/\//,
    );
  });

  it('unwraps a cors-proxied remote url back to the real url', () => {
    const remote = 'https://i.imgflip.com/6qyam6.mp4';
    const proxied = '/cors-proxy/' + encodeURIComponent(remote);
    expect(resolveAudioPath(proxied)).toBe(remote);
  });

  it('strips query strings before resolving', () => {
    expect(resolveAudioPath('https://x.com/a.mp4?asset-hash=abc')).toBe(
      'https://x.com/a.mp4',
    );
  });

  it('resolves an /@fs absolute path', () => {
    expect(resolveAudioPath('/@fs/home/dev/media/song.opus')).toBe(
      '/home/dev/media/song.opus',
    );
  });

  it('decodes an /@fs path with encoded characters', () => {
    expect(resolveAudioPath('/@fs/home/dev/a%20b/song.opus')).toBe(
      '/home/dev/a b/song.opus',
    );
  });

  it('resolves a project-relative url to a filesystem path', () => {
    expect(resolveAudioPath('/media/clip.opus')).toBe('media/clip.opus');
  });
});
