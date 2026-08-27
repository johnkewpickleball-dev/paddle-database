/* KewCOR core arithmetic — no DOM, no network, no globals beyond the export.
 *
 * This is a direct port of the spreadsheet's math. It is deliberately the ONLY
 * place any of it is written down on this side: the HTML runner does presentation
 * and nothing else. Every function here is covered by kewcor-core.test.js, whose
 * expected values come out of the Python suites that already validate the workbook
 * (validate.py, ramp_test.py, perblock_test.py) rather than from this file.
 *
 * Works unchanged in a browser (<script src>) and in node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KewCOR = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── constants, mirroring the Setup tab ────────────────────────────────────
  const C = {
    fixtureQ: 10.008,       // Setup C12 — MEASURED pivot-to-aim-point, a fixture
                            // constant. The control paddle's strike location is
                            // DERIVED from this, never the other way round: 3 mm of
                            // error here is worth 0.001 of KewCOR.
    clampMOI: 12.15,        // Setup C14, clamp swing weight
    clampDepth: 2.00,       // Setup C15, in from butt cap. LOCKED.
    target: 50.0,           // Setup C16, and the whole published scale is anchored here
    window: 7.0,            // Setup C17, accept 50 +/- this
    perLoc: 10,             // Setup C18, shots per impact location
    ballOz: 0.92,           // Setup C19
    slope: -0.00451,        // Setup C23, dPBCoR/dVin
    curv: 0.0,              // Setup C24, deliberately zero
    wearFactor: 0.44,       // Setup C25, a 70 mph glancing wear shot in 50 mph impacts
    tau: 52.0,              // Setup C26, wear-curve time constant
    locations: [3, 4, 5, 6, 7],
    /* THE ANCHOR'S CONTROL SPOT — where the weekly reference block is shot.
     *
     * It was going to be the mirror image of the crosshair across the centerline: same
     * distance from the pivot, same effective mass, identical in every way except wear,
     * so crosshair minus control was wear and nothing else. The rig aims along the
     * paddle's long axis only, so that point cannot be reached.
     *
     * 6 in instead — John's call, 2026-08-25. It is 1.9 in clear of the 4.07 crosshair,
     * so the worn zone can never reach it. The cost: a different q, therefore a
     * different effective mass and a genuinely different intrinsic PBCoR. On Anchor 2
     * the two differ by about 0.003 before any wear at all.
     *
     * SO THE RAW GAP IS NOT A WEAR FIGURE. Only its CHANGE over time is, and only while
     * the spot never moves — a switch to 3 in would put a step of roughly 0.02 into the
     * series, four times the drift that matters. Pick one, log it, keep it. */
    controlSpot: 6.0,
    breakInGate: 40,        // registry Settings B5 — has the ball had its wear phase
    plateau: 190,           // past here the ramp and a straight line agree
    retire: 600
  };
  C.ballKg = C.ballOz * 0.0283495;

  const ANCHORS = {
    'Anchor 1': { id: 'TFG-1', paddle: 'CRBN1 TruFoam Genesis', pRef: 0.3834,
                  swingWt: 124.39, length: 16.50, markedAt: 4.50, status: 'RETIRED - reference only' },
    'Anchor 2': { id: 'TFG-4', paddle: 'CRBN4 TruFoam Genesis', pRef: 0.4127,
                  swingWt: 109.19, length: 16.07, markedAt: 4.07, status: 'IN USE' },
    'Anchor 3': { id: 'TFW-3', paddle: 'CRBN3 TruFoam Waves', pRef: 0.4094,
                  swingWt: 121.17, length: 16.42, markedAt: 4.42, status: 'SPARE' }
  };

  // ── one shot ──────────────────────────────────────────────────────────────
  // Effective mass at the strike point. q is pivot-to-impact in INCHES; the
  // formula wants centimetres, hence the 2.54.
  const effMass = (swingWt, qIn) => (swingWt + C.clampMOI) / Math.pow(qIn * 2.54, 2);

  // PBCoR = (Vin+Vout)/Vin * (m/Me + 1) - 1
  function pbcor(vin, vout, swingWt, qIn) {
    const Me = effMass(swingWt, qIn);
    return (vin + vout) / vin * (C.ballKg / Me + 1) - 1;
  }

  // Every shot is corrected to 50 mph BEFORE anything is averaged. This is what
  // makes the +/-7 window safe: without it a fast shot would bias its location.
  function correctTo50(pRaw, vin) {
    const dv = vin - C.target;
    return pRaw - C.slope * dv - C.curv * dv * dv;
  }

  const qForLocation = (paddleLength, locIn) => paddleLength - C.clampDepth - locIn;

  // The CONTROL block always sits at the fixture's own Q. The anchor's "marked at"
  // is the silver crosshair on the face and exists to be cross-checked against this,
  // not to be used in its place — they agree to about 0.01 in and the sheet flags it
  // if they ever stop agreeing.
  const controlQ = () => C.fixtureQ;
  const strikeLocation = paddleLength => paddleLength - C.clampDepth - C.fixtureQ;

  // ── a block of shots ──────────────────────────────────────────────────────
  // status is USE / REJECT vel / MISSING Vout / PASTE MISALIGNED, matching the
  // sheet's column M so the two can be compared row for row while both exist.
  function classify(shot) {
    if (shot.vin == null || !isFinite(shot.vin)) return 'EMPTY';
    if (shot.vout == null || !isFinite(shot.vout)) return 'MISSING Vout';
    if (shot.gateCor != null && isFinite(shot.gateCor) &&
        Math.abs(shot.gateCor - shot.vout / shot.vin) > 0.02) return 'PASTE MISALIGNED';
    if (Math.abs(shot.vin - C.target) > C.window) return 'REJECT vel';
    return 'USE';
  }

  function summarize(shots, swingWt, qIn) {
    const rows = shots.map(s => {
      const status = classify(s);
      const raw = status === 'USE' ? pbcor(s.vin, s.vout, swingWt, qIn) : null;
      return { ...s, status, pRaw: raw, p50: raw == null ? null : correctTo50(raw, s.vin) };
    });
    const used = rows.filter(r => r.status === 'USE');
    const n = used.length;
    const fired = rows.filter(r => r.status !== 'EMPTY').length;
    if (!n) return { rows, n, fired, mean: null, sd: null, se: null, meanVin: null };
    const mean = used.reduce((a, r) => a + r.p50, 0) / n;
    const sd = n > 1 ? Math.sqrt(used.reduce((a, r) => a + (r.p50 - mean) ** 2, 0) / (n - 1)) : null;
    return { rows, n, fired, mean, sd, se: sd == null ? null : sd / Math.sqrt(n),
             meanVin: used.reduce((a, r) => a + r.vin, 0) / n };
  }

  // ── the ball ──────────────────────────────────────────────────────────────
  // A 70 mph wear shot is a GLANCING blow off a 30-degree clamp, so it counts for
  // LESS than a 50 mph impact, not more. See the wear-phase note in Design Notes.
  const effectiveAge = (prior, wearShots) => (prior || 0) + (wearShots || 0) * C.wearFactor;

  const D = (pRef, pCtrl) => pRef * pRef - pCtrl * pCtrl;

  // The share of a segment's total ball drift completed m impacts in. The wear
  // curve's amplitude, its floor AND the ball's absolute age all cancel out of
  // this — only tau survives, which is why the ramp does not depend on the 0.44.
  function curveFraction(m, N, tau) {
    tau = tau || C.tau;
    if (!(N > 0)) return 0;
    return (1 - Math.exp(-m / tau)) / (1 - Math.exp(-N / tau));
  }

  // ── ramp mode ─────────────────────────────────────────────────────────────
  // AUTO ramps only when PRE and POST differ by more than 2 standard errors.
  // Below that the difference is noise, and ramping on noise makes every paddle
  // worse rather than better.
  function driftMode({ pre, post, forced }) {
    if (forced === 'RAMP') return { mode: 'RAMP (forced)', ramp: true, t: null };
    if (forced === 'POOLED') return { mode: 'POOLED (forced)', ramp: false, t: null };
    if (!post || !post.n) return { mode: 'POOLED (no POST block yet)', ramp: false, t: null };
    const diff = post.mean - pre.mean;
    const sed = Math.sqrt(pre.se ** 2 + post.se ** 2);
    const t = diff / sed;
    return Math.abs(t) > 2
      ? { mode: 'RAMP (drift is real)', ramp: true, t, diff, sed }
      : { mode: 'POOLED (drift is noise)', ramp: false, t, diff, sed };
  }

  function pooledD(pRef, pre, post) {
    const n1 = pre.n, n2 = post && post.n ? post.n : 0;
    const p = n2 ? (pre.mean * n1 + post.mean * n2) / (n1 + n2) : pre.mean;
    return D(pRef, p);
  }

  // ── where each paddle and each location block sits in the ball's life ─────
  // Ages are measured in impacts. A block of shots characterises the ball at its
  // own MIDPOINT, never at its start or end.
  function ballTimeline({ prior, wearShots, preFired, midFired, postFired, paddleShots, midAfterPaddle }) {
    const base = effectiveAge(prior, wearShots);
    const agePre = base + preFired / 2;
    const before = [];
    let run = base + preFired;
    paddleShots.forEach(n => { before.push(run); run += n; });
    const total = paddleShots.reduce((a, b) => a + b, 0);
    const midLive = midAfterPaddle > 0 && midFired > 0;
    const impactsBeforeMid = midLive
      ? paddleShots.slice(0, midAfterPaddle).reduce((a, b) => a + b, 0) : null;
    const ageMid = midLive ? base + preFired + impactsBeforeMid + midFired / 2 : null;
    const agePost = base + preFired + total + (midFired || 0) + postFired / 2;
    return { base, agePre, ageMid, agePost, paddleStart: before,
             ageAfter: base + preFired + total + (midFired || 0) + postFired,
             midLive, impactsBeforeMid };
  }

  // Which pair of measured anchors does this paddle interpolate between?
  function segmentFor(midpointAge, tl, dPre, dMid, dPost) {
    if (tl.midLive && midpointAge > tl.ageMid)
      return { a: tl.ageMid, b: tl.agePost, Da: dMid, Db: dPost };
    if (tl.midLive)
      return { a: tl.agePre, b: tl.ageMid, Da: dPre, Db: dMid };
    return { a: tl.agePre, b: tl.agePost, Da: dPre, Db: dPost };
  }

  // ── PER LOCATION BLOCK, not per paddle ────────────────────────────────────
  // The ball keeps decaying while a paddle is being shot, and because locations
  // are shot in blocks from the top of the face downward, one D per paddle would
  // leave that decay behind as a gradient across the face map. Each block gets
  // its own D, taken at the moment that block of ten was actually fired.
  // blockCounts is how many shots ACTUALLY landed in each location block, in firing
  // order. The workbook has to assume a fixed ten per block because it assigns shots
  // to locations by row position; the runner knows the real counts because each
  // location has its own box. With ten everywhere the two agree exactly, which is
  // what the fixtures check — where they differ, the runner is the more correct one.
  function blockCorrections({ slot, tl, dPre, dMid, dPost, ramp, pooled,
                              shotsFired, nLocations, blockCounts }) {
    const start = tl.paddleStart[slot];
    const counts = blockCounts || Array.from({ length: nLocations }, (_, i) =>
      Math.min(C.perLoc, Math.max(0, shotsFired - i * C.perLoc)));
    const total = blockCounts ? counts.reduce((a, b) => a + b, 0) : shotsFired;
    const out = [];
    let offset = 0;
    for (let i = 0; i < (nLocations || counts.length); i++) {
      const n = counts[i] || 0;
      if (!ramp) { out.push(pooled); offset += n; continue; }
      const mid = start + offset + n / 2;
      const seg = segmentFor(start + total / 2, tl, dPre, dMid, dPost);
      const f = curveFraction(mid - seg.a, seg.b - seg.a);
      out.push(seg.Da + (seg.Db - seg.Da) * f);
      offset += n;
    }
    return out;
  }

  // ── the published number ──────────────────────────────────────────────────
  // KewCOR = SQRT(PBCoR@50^2 + D), applied to the LOCATION MEAN — not shot by
  // shot, so a noisy individual shot cannot leak in through the square root.
  // shots is either a flat array (sliced into blocks of perLoc, as the workbook does)
  // or an array of per-location arrays, which is what the runner's separate paste
  // boxes give and which cannot be mis-assigned by an extra shot somewhere.
  function locationResults(shots, paddleLength, swingWt, locations, blockD) {
    const grouped = Array.isArray(shots[0]);
    return locations.map((loc, i) => {
      const qIn = qForLocation(paddleLength, loc);
      const slice = grouped ? (shots[i] || []) : shots.slice(i * C.perLoc, (i + 1) * C.perLoc);
      const s = summarize(slice, swingWt, qIn);
      const d = blockD[i];
      return {
        location: loc, q: qIn, fired: s.fired, used: s.n, meanVin: s.meanVin,
        p50: s.mean, sd: s.sd, se: s.se, D: d,
        kewcor: s.mean == null || d == null ? null : Math.sqrt(s.mean * s.mean + d),
        rows: s.rows
      };
    });
  }

  function faceSummary(locs) {
    const live = locs.filter(l => l.kewcor != null);
    if (!live.length) return null;
    const peak = live.reduce((a, b) => (b.kewcor > a.kewcor ? b : a));
    const max = peak.kewcor, min = live.reduce((a, b) => Math.min(a, b.kewcor), Infinity);
    // Bands read off the published KewCOR graphic. OUT OF SPEC at 0.445 and above.
    const band = max < 0.365 ? 'LOW POWER' : max < 0.390 ? 'MID POWER'
               : max < 0.445 ? 'HIGH POWER' : 'OUT OF SPEC';
    return { peakLocation: peak.location, max, variance: max - min, band };
  }

  // ── the client report ─────────────────────────────────────────────────────
  // The four published bands, read off the KewCOR graphic. Kept as data rather than
  // as the chain of comparisons in faceSummary(), because the report also has to DRAW
  // them, and two hand-maintained copies of the same four numbers is one too many.
  const BANDS = [
    { name: 'LOW POWER',   from: 0.340, to: 0.365 },
    { name: 'MID POWER',   from: 0.365, to: 0.390 },
    { name: 'HIGH POWER',  from: 0.390, to: 0.445 },
    { name: 'OUT OF SPEC', from: 0.445, to: 0.520 }
  ];
  const BAND_LO = 0.34, BAND_HI = 0.52;        // Client Report B40, the strip's ends

  // Where the pointer goes on that strip, 0 to 1. Clamped: a paddle off either end
  // still gets a pointer at the end rather than falling off the graphic.
  function bandPosition(max) {
    if (max == null || !isFinite(max)) return null;
    return Math.max(0, Math.min(1, (max - BAND_LO) / (BAND_HI - BAND_LO)));
  }

  const round6 = v => Math.round(v * 1e6) / 1e6;

  /* The report's vertical axis, which is NOT the runner's.
   *
   * The runner uses a 0.07 window centered on the paddle, to show shape. The report
   * uses the published 0.10 window, 0.33 to 0.43, so that two reports can be laid side
   * by side and compared by eye — which is the whole point of fixing an axis, and the
   * reason it must not quietly re-center per paddle.
   *
   * A paddle outside that range keeps the 0.10 SPAN and slides the window, exactly as
   * Client Report L15/L16 compute it. In the workbook those two cells only tell you
   * what to type into the chart editor by hand; here it just happens. */
  function reportAxis(values) {
    const live = (values || []).filter(v => v != null && isFinite(v));
    if (!live.length) return { lo: 0.33, hi: 0.43, fixed: true };
    const min = Math.min.apply(null, live), max = Math.max.apply(null, live);
    const span = max - min;
    if (min >= 0.33 && max <= 0.43) return { lo: 0.33, hi: 0.43, fixed: true };
    const floorTo = (v, s) => Math.floor(v / s + 1e-9) * s;
    const ceilTo  = (v, s) => Math.ceil(v / s - 1e-9) * s;
    const lo = floorTo(span >= 0.1 ? min - 0.005 : min - (0.1 - span) / 2, 0.01);
    const hi = Math.max(lo + 0.1, ceilTo(max + 0.002, 0.01));
    return { lo: round6(lo), hi: round6(hi), fixed: false };
  }

  /* THE REPORT TRAVELS IN THE URL, so a report is a link and nothing has to be stored
   * or served for it to work. Base64url of compact JSON in the hash — the hash is never
   * sent to the server, so the payload does not turn up in anybody's access log.
   *
   * Deliberately only what the report DISPLAYS. Not the shot rows, not the standard
   * errors, not the block corrections: a client link should not carry lab internals
   * that nothing on the page will show, and a smaller payload is a shorter link.
   *
   * `v` is a version. A report link is a thing somebody may open a year later, and a
   * reader that cannot tell which shape it is holding has no way to fail honestly. */
  function encodeReport(obj) {
    const json = JSON.stringify(obj);
    const b64 = (typeof btoa === 'function')
      ? btoa(unescape(encodeURIComponent(json)))
      : Buffer.from(json, 'utf8').toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeReport(str) {
    if (!str) return null;
    const b64 = String(str).replace(/^#/, '').replace(/-/g, '+').replace(/_/g, '/');
    let json;
    try {
      json = (typeof atob === 'function')
        ? decodeURIComponent(escape(atob(b64)))
        : Buffer.from(b64, 'base64').toString('utf8');
    } catch (e) { throw new Error('This report link is damaged - the text after the # is not '
      + 'readable. It was probably cut short somewhere between here and the sender.'); }
    let o;
    try { o = JSON.parse(json); }
    catch (e) { throw new Error('This report link is damaged - it decoded, but not into a '
      + 'report. It was probably truncated.'); }
    if (!o || typeof o !== 'object') throw new Error('This report link does not hold a report.');
    if (o.v !== 1) throw new Error('This link is version ' + o.v + ' and this page reads '
      + 'version 1. Re-issue it from the session runner.');
    return o;
  }

  // ── does today's ball want the MID block? ─────────────────────────────────
  function midAdvice(effAge, plannedImpacts) {
    if (effAge == null) return null;
    if (effAge >= C.plateau)
      return { verdict: 'NOT NEEDED', why: `This ball is at ${Math.round(effAge)} effective impacts, `
        + 'on the plateau, where the straight line and the curve agree to better than 0.0005.' };
    if (plannedImpacts < 90)
      return { verdict: 'NOT NEEDED YET', why: 'Under 90 paddle impacts planned today.' };
    return { verdict: 'SHOOT IT', why: `This ball is at ${Math.round(effAge)} effective impacts, `
      + `still on the steep part of the curve, and today runs ${plannedImpacts} paddle impacts. `
      + 'Ten shots at the control paddle between paddles 2 and 3.' };
  }

  function ballStage(effAge) {
    if (effAge < C.breakInGate) return 'NOT WEAR-PHASED';
    if (effAge >= C.retire) return 'RETIRE IT';
    if (effAge >= 500) return 'LATE LIFE - watch the seam';
    return 'IN SERVICE';
  }

  return { C, ANCHORS, effMass, pbcor, correctTo50, qForLocation, controlQ, strikeLocation,
           classify, summarize,
           effectiveAge, D, curveFraction, driftMode, pooledD, ballTimeline, segmentFor,
           blockCorrections, locationResults, faceSummary, midAdvice, ballStage,
           BANDS, BAND_LO, BAND_HI, bandPosition, reportAxis, encodeReport, decodeReport };
}));
