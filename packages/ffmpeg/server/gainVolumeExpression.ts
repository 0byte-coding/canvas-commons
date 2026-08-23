interface GainPoint {
  t: number;
  // dB gain: the envelope is piecewise-linear in dB, so simplification and the
  // collinearity check happen here, not in linear-amplitude space (where a
  // dB-linear ramp is an exponential curve).
  db: number;
}

const MIN_TIME_SPAN = 1e-4;
const COLLINEAR_DB_TOLERANCE = 0.05;

function toLinear(db: number): number {
  return Math.pow(10, db / 20);
}

// Merge points closer than MIN_TIME_SPAN in time (keeping the later gain) so no
// segment ever divides by a span that rounds to zero in the emitted expression.
function mergeCloseInTime(points: GainPoint[]): GainPoint[] {
  const merged: GainPoint[] = [];
  for (const point of points) {
    const last = merged[merged.length - 1];
    if (last && point.t - last.t < MIN_TIME_SPAN) {
      last.db = point.db;
      continue;
    }
    merged.push({...point});
  }
  return merged;
}

// Drop interior points that lie (within tolerance) on the straight dB line
// between their neighbours, collapsing a per-frame ramp into its endpoints.
function dropCollinear(points: GainPoint[]): GainPoint[] {
  if (points.length <= 2) {
    return points;
  }
  const kept: GainPoint[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = kept[kept.length - 1];
    const curr = points[i];
    const next = points[i + 1];
    const span = next.t - prev.t;
    if (span <= 0) {
      continue;
    }
    const expected = prev.db + ((next.db - prev.db) * (curr.t - prev.t)) / span;
    if (Math.abs(curr.db - expected) > COLLINEAR_DB_TOLERANCE) {
      kept.push(curr);
    }
  }
  kept.push(points[points.length - 1]);
  return kept;
}

/**
 * Build an FFmpeg `volume` expression (evaluated per frame) that reproduces a
 * piecewise-linear dB gain envelope.
 *
 * @remarks
 * Keyframe times are scene-absolute seconds. The filter sits before
 * `asetrate`/`adelay`, so `t` is source-relative seconds (clip start = 0),
 * obtained by subtracting the clip's scene start and scaling by the playback
 * rate. A negative offset means the clip begins before scene 0 (a whole-file
 * clip trimmed at its head via `-ss`), so its on-screen start is clamped to 0 -
 * matching where the filter's `t` actually begins. The returned expression
 * yields a linear amplitude multiplier with its commas escaped for use inside
 * `filter_complex`. Near-duplicate and collinear keyframes are merged so the
 * expression stays small and never divides by a zero span.
 *
 * @param events - Envelope keyframes (scene-absolute seconds, dB gain).
 * @param offset - The clip's scene offset in seconds.
 * @param rate - The clip's real playback rate.
 */
export function buildGainVolumeExpression(
  events: {time: number; gain: number}[],
  offset: number,
  rate: number,
): string {
  const sceneStart = Math.max(0, offset);
  const toLocalTime = (sceneTime: number): number =>
    Math.max(0, sceneTime - sceneStart) * rate;

  const raw = events
    .map(e => ({t: toLocalTime(e.time), db: e.gain}))
    .sort((a, b) => a.t - b.t);

  const points = dropCollinear(mergeCloseInTime(raw));

  const flat = points.every(
    p => Math.abs(p.db - points[0].db) <= Number.EPSILON,
  );
  if (points.length === 1 || flat) {
    return toLinear(points[0].db).toFixed(6);
  }

  // The envelope is piecewise-linear in dB, so interpolate dB (exact, small)
  // and convert to a linear amplitude multiplier inside ffmpeg. Held flat after
  // the last keyframe.
  let dbExpr = points[points.length - 1].db.toFixed(6);
  for (let i = points.length - 1; i >= 1; i--) {
    const prev = points[i - 1];
    const next = points[i];
    const span = next.t - prev.t;
    const segment = `(${prev.db.toFixed(6)}+(${(next.db - prev.db).toFixed(
      6,
    )})*(t-${prev.t.toFixed(6)})/${span.toFixed(6)})`;
    dbExpr = `if(lt(t,${next.t.toFixed(6)}),${segment},${dbExpr})`;
  }
  // Held flat before the first keyframe.
  dbExpr = `if(lt(t,${points[0].t.toFixed(6)}),${points[0].db.toFixed(
    6,
  )},${dbExpr})`;

  const expr = `pow(10,(${dbExpr})/20)`;
  return expr.replace(/,/g, '\\,');
}
