import {DependencyContext} from '@canvas-commons/core';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {useScene2D} from '../../scenes';
import {Video} from '../Video';
import {mockScene2D} from './mockScene2D';

describe('Video readiness', () => {
  mockScene2D();

  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(
      0,
    );
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('does not wait for a media element that a fixed size does not need', () => {
    const video = new Video({src: 'clip.mp4', width: 1920, height: 1080});
    useScene2D().getView().add(video);

    video['collectAsyncResources']();

    expect(DependencyContext.hasPromises()).toBe(false);
  });

  it('waits for the element when the size comes from the media', async () => {
    const video = new Video({src: 'clip.mp4'});
    useScene2D().getView().add(video);

    video['collectAsyncResources']();
    const collected = DependencyContext.hasPromises();

    // an unresolved resource would keep the next scene reset waiting
    video['video']().dispatchEvent(new Event('canplay'));
    await DependencyContext.consumePromises();

    expect(collected).toBe(true);
  });

  it('keeps the in point while the duration is unknown', () => {
    const video = new Video({src: 'clip.mp4', time: 12});
    useScene2D().getView().add(video);

    expect(video.getCurrentTime()).toBe(12);
  });
});
