/**
 * Build the FFmpeg `volume` filter options for a constant gain (in dB).
 *
 * @remarks
 * A muted clip has a gain of `-Infinity` dB (`gainToDb(0)`), which FFmpeg's
 * `volume` filter cannot parse as `-InfinitydB` - it would error out and leave
 * the clip at full volume. Non-finite gains are emitted as a linear `volume=0`
 * (silence) instead.
 *
 * @param gain - The constant gain in decibels.
 */
export function formatConstantGainVolume(gain: number): {volume: string} {
  return isFinite(gain) ? {volume: `${gain}dB`} : {volume: '0'};
}
