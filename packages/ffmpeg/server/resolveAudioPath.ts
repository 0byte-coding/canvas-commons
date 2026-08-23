const HTTP_URL = /^https?:\/\//i;
const CORS_PROXY_PREFIX = '/cors-proxy/';
const FS_PREFIX = '/@fs';

/**
 * Resolve an audio asset URL to something ffmpeg can open.
 *
 * @remarks
 * Remote http(s) sources - including ones wrapped by the dev-server cors proxy
 * (`/cors-proxy/<encoded-url>`) - are returned as urls, which ffmpeg opens
 * directly server-side (no CORS applies there). Assets imported by absolute
 * path (outside the Vite root) are served under `/@fs/`; everything else is a
 * project-relative url resolved to a filesystem path.
 */
export function resolveAudioPath(url: string): string {
  const clean = url.split('?')[0];

  if (HTTP_URL.test(clean)) {
    return clean;
  }

  if (clean.startsWith(CORS_PROXY_PREFIX)) {
    const unwrapped = decodeURIComponent(clean.slice(CORS_PROXY_PREFIX.length));
    if (HTTP_URL.test(unwrapped)) {
      return unwrapped;
    }
  }

  if (clean.startsWith(`${FS_PREFIX}/`)) {
    return decodeURIComponent(clean.slice(FS_PREFIX.length));
  }

  return decodeURIComponent(clean.slice(1));
}
