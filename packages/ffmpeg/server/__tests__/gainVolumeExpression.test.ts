import {describe, expect, it} from 'vitest';
import {buildGainVolumeExpression} from '../gainVolumeExpression';

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

// Translate an ffmpeg `volume` expression (if/lt/pow) into evaluable JS.
function toJsExpr(expr: string): string {
  return expr
    .replace(/\\,/g, ',')
    .replace(/pow\(/g, 'Math.pow(')
    .replace(/lt\(/g, 'ffLt(')
    .replace(/if\(/g, 'ffIf(');
}

function evalExpr(expr: string, t: number): number {
  const ffLt = (a: number, b: number): boolean => a < b;
  const ffIf = (c: boolean, a: number, b: number): number => (c ? a : b);
  const fn = new Function('ffLt', 'ffIf', 't', `return ${toJsExpr(expr)};`) as (
    lt: typeof ffLt,
    iff: typeof ffIf,
    t: number,
  ) => number;
  return fn(ffLt, ffIf, t);
}

function makeRamp(
  fromDb: number,
  toDb: number,
  start: number,
  duration: number,
  fps: number,
): {time: number; gain: number}[] {
  const frames = Math.round(duration * fps);
  const events: {time: number; gain: number}[] = [];
  for (let i = 0; i <= frames; i++) {
    const t = i / fps;
    const k = t / duration;
    events.push({time: start + t, gain: fromDb + (toDb - fromDb) * k});
  }
  // The tween records a final duplicate keyframe at the exact end time.
  events.push({time: start + duration, gain: toDb});
  return events;
}

describe('buildGainVolumeExpression()', () => {
  it('never emits a zero span divisor', () => {
    const events = makeRamp(-40, -16, 0, 1, 60);
    const expr = buildGainVolumeExpression(events, 0, 1);
    expect(expr).not.toContain('/0.000000');
  });

  it('collapses a per-frame linear ramp to its two endpoints', () => {
    const events = makeRamp(-40, -16, 0, 1, 60);
    const expr = buildGainVolumeExpression(events, 0, 1);
    // A single linear segment needs only the before/segment/after ifs, not one
    // per recorded frame.
    const ifs = (expr.match(/if\(/g) ?? []).length;
    expect(ifs).toBeLessThanOrEqual(2);
  });

  it('keeps distinct slopes as separate segments', () => {
    // Up then down: two ramps meeting at a peak.
    const up = makeRamp(-40, -16, 0, 1, 60);
    const hold = [{time: 2, gain: -16}];
    const down = makeRamp(-16, -40, 2, 1, 60);
    const expr = buildGainVolumeExpression([...up, ...hold, ...down], 0, 1);
    expect(expr).not.toContain('/0.000000');
    const ifs = (expr.match(/if\(/g) ?? []).length;
    // Two ramps -> at most a handful of segments, far from per-frame.
    expect(ifs).toBeGreaterThan(1);
    expect(ifs).toBeLessThanOrEqual(6);
  });

  it('returns a bare constant for a flat envelope', () => {
    const expr = buildGainVolumeExpression(
      [
        {time: 0, gain: -20},
        {time: 5, gain: -20},
      ],
      0,
      1,
    );
    expect(expr).toBe(dbToLinear(-20).toFixed(6));
    expect(expr).not.toContain('if(');
  });

  it('escapes commas for filter_complex parsing', () => {
    const events = makeRamp(-40, -16, 0, 1, 60);
    const expr = buildGainVolumeExpression(events, 0, 1);
    expect(expr).not.toMatch(/[^\\],/);
  });

  it('samples to a gain that closely tracks the dB ramp', () => {
    const events = makeRamp(-40, -16, 0, 1, 60);
    const expr = buildGainVolumeExpression(events, 0, 1);
    const refDbLinear = (t: number): number =>
      dbToLinear(-40 + (-16 - -40) * Math.min(1, Math.max(0, t)));

    expect(evalExpr(expr, 0)).toBeCloseTo(dbToLinear(-40), 4);
    expect(evalExpr(expr, 1)).toBeCloseTo(dbToLinear(-16), 4);
    // Amplitude-linear segments between sparse dB keyframes stay within a small
    // tolerance of the true dB ramp.
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(evalExpr(expr, t)).toBeCloseTo(refDbLinear(t), 2);
    }
  });

  it('applies the clip offset and playback rate to keyframe times', () => {
    const events = [
      {time: 10, gain: -20},
      {time: 12, gain: -10},
    ];
    const expr = buildGainVolumeExpression(events, 10, 2).replace(/\\,/g, ',');
    // scene 10 -> local 0, scene 12 -> local (12-10)*2 = 4.
    expect(expr).toContain('t,4.000000');
  });
});
