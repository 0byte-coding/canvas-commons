/**
 * Convert a decibel value to a linear amplitude gain factor.
 */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Convert a linear amplitude gain factor to decibels.
 *
 * @remarks
 * The inverse of {@link dbToGain}. `gain <= 0` maps to `-Infinity` (silence).
 */
export function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain);
}

/**
 * Sample a piecewise-linear gain envelope (in dB) at a given time.
 *
 * @remarks
 * Events are assumed sorted by ascending `time`. The value is held flat before
 * the first event and after the last one, and linearly interpolated between
 * adjacent events.
 *
 * @param events - The envelope keyframes.
 * @param time - The time to sample at, in the same units as the events.
 * @param fallback - Returned when the envelope is empty.
 */
export function sampleGainEvents(
  events: {time: number; gain: number}[],
  time: number,
  fallback = 0,
): number {
  if (events.length === 0) {
    return fallback;
  }
  if (time <= events[0].time) {
    return events[0].gain;
  }
  const last = events[events.length - 1];
  if (time >= last.time) {
    return last.gain;
  }
  for (let i = 1; i < events.length; i++) {
    const next = events[i];
    if (time <= next.time) {
      const prev = events[i - 1];
      const span = next.time - prev.time;
      if (span <= 0) {
        return next.gain;
      }
      const t = (time - prev.time) / span;
      return prev.gain + (next.gain - prev.gain) * t;
    }
  }
  return last.gain;
}
