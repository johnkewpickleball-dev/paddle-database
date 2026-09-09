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

  /* BUILD — bump on EVERY change to the arithmetic in this file.
   *
   * The runner is used on a separate machine at the cannon, over the published
   * page, and that machine cannot be inspected from the authoring side. The
   * session header prints this number beside the endpoint build so the operator
   * can confirm which arithmetic is loaded before firing a shot. The pages also
   * request this file as kewcor-core.js?v=<BUILD>, so a bump busts the cache.
   * Leave them out of step and a cached core against a fresh page computes with
   * old math while looking current, which is the worst failure available here.
   *
   *   1  2026-08-29  as shipped
   *   2  2026-09-08  ball-age gate on RAMP; pooledD prefers MID and POST over PRE
   *   3  2026-09-09  PRE is 16 shots, first 6 discarded as overnight warm-up
   */
  const BUILD = 3;

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
    /* RAMP CEILING — above this effective age AUTO refuses to ramp. 2026-09-08.
     *
     * Three different age thresholds live in this file and they are NOT interchangeable:
     *   breakInGate 40   has the ball had its wear phase at all
     *   rampMaxAge  80   above here, pooling MID and POST beats ramping
     *   plateau    190   above here the MID block buys nothing
     *
     * Why 80. Simulation of a four-paddle session, 45 impacts each, anchor se 0.008,
     * worst-paddle RMS error in the control value. Pooling MID and POST overtakes a
     * three-anchor ramp at about age 82 with a clean PRE, and at about age 38 once PRE
     * carries the measured +0.020 of overnight recovery. 80 is the conservative end, the
     * value that keeps RAMP alive longest.
     *
     * On a plateaued ball with PRE inflated 0.020, worst-paddle RMS:
     *     RAMP, three anchors        0.0118
     *     RAMP, MID to POST only     0.0459   <- never do this. Paddle 1 falls outside
     *                                            the segment and backward extrapolation
     *                                            on an exponential amplifies noise ~6x.
     *     POOLED, all three          0.0081
     *     POOLED, MID and POST only  0.0057   <- the target, and what pooledD now does
     *
     * THIS DOES NOT TURN RAMP OFF. At wearFactor 0.44 a wear-phased ball enters at
     * ~44 effective, on the steepest part of the curve, so a new ball's first session
     * still ramps and should. The gate bites on the far side of the curve, which is
     * where it went wrong. Between 44 and 80 the right answer depends on how large the
     * overnight recovery on PRE really is; 80 keeps the current behavior there until
     * the OVERNIGHT CHANGE log settles it.
     *
     * What went wrong without it: on 2026-08-25 the control moved 0.4321 to 0.3851,
     * t = -4.32, so AUTO chose RAMP. LT-89 sat at ~177 effective (133 crossover + 100
     * wear shots x 0.44), where the curve leaves about 0.0015 of decay across a whole
     * session, roughly thirty times smaller than the move being fitted. The ramp spread
     * a non-wear move across the session and handed four paddles D from -0.00823 to
     * +0.02279, a spread of 0.031 that is pure firing order. */
    rampMaxAge: 80,

    /* THE PRE BLOCK IS 16 SHOTS AND THE FIRST 6 ARE THROWN AWAY. 2026-09-09.
     *
     * A ball that has rested overnight reads high. Measured across four saved runner
     * drafts, 35 gated PRE shots on Anchor 2: PRE sits +0.028 above that session's settled
     * level, and the SHAPE IS A STEP, not a decay. Elevated for about six impacts, then on
     * its curve. A step at shot 7 fits at RSS 0.0199 against 0.0275 flat and 0.0220 for the
     * best exponential, and the exponential fit degenerates toward a straight line, which is
     * the signature of the wrong functional form. Do not model this as a relaxation.
     * Discarding the first six leaves a residual bias of +0.0012 (se 0.0051, t = 0.24).
     *
     * SIX IS A LOWER BOUND. The baseline it was measured against is the MID and POST mean,
     * which sits later in the day and is therefore below the true ball state at impact 10.
     * That biases the measured tail downward, so if anything the boundary is later than 6.
     *
     * Why 16 rather than discarding 6 from the old 10. Four usable shots carry se near
     * 0.012, worse than the 0.008 the block has today, so discarding alone trades one error
     * for another. 16 clears the recovery AND keeps a full ten-shot measurement. It costs
     * 6 impacts a session, against the 20 that widening PRE to 30 would have cost.
     *
     * THE SPLIT IS POSITIONAL AND HAPPENS BEFORE THE VELOCITY GATE. Warm-up is about how
     * many times the ball has been struck, not about which strikes the gate liked. In that
     * four-session set six of the seven PRE gate rejects landed on shots 3 to 5, so gating
     * first would move the boundary around from session to session.
     *
     * This is also why a sorted paste is worse here than anywhere else on the page. Sorted,
     * the split discards the six SLOWEST shots instead of the six EARLIEST, which is not a
     * warm-up correction at all.
     *
     * Alternatives rejected: lowering rampMaxAge toward 40, which turns RAMP off almost
     * always since a wear-phased ball enters at ~44; and subtracting the measured offset
     * from PRE, which bakes a four-session constant into the arithmetic when the offset
     * ranged from +0.048 to -0.007 across those sessions. */
    preWarmup: 6,
    preUsed: 10,
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
    // Dropped by hand, with `x` at the front of the line. Checked BEFORE the automatic
    // statuses so a person's judgment is never overridden by a rule, and checked AFTER
    // EMPTY so an `x` on a blank line is still just a blank line.
    if (shot.dropped) return 'DROPPED';
    if (shot.vout == null || !isFinite(shot.vout)) return 'MISSING Vout';
    if (shot.gateCor != null && isFinite(shot.gateCor) &&
        Math.abs(shot.gateCor - shot.vout / shot.vin) > 0.02) return 'PASTE MISALIGNED';
    if (Math.abs(shot.vin - C.target) > C.window) return 'REJECT vel';
    return 'USE';
  }

  // The middle value of whatever is there. Median rather than mean on purpose: the thing
  // being looked for is an outlier, and an outlier drags a mean toward itself, which is
  // how an outlier detector ends up excusing the outlier.
  function median(xs) {
    const v = xs.filter(x => x != null && isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }

  // How far below its block's median a rebound ratio has to sit before the shot is worth
  // a second look. RELATIVE, because the ratio itself runs about 0.098 at 2 in and 0.291
  // at 6 in -- any fixed floor either flags every shot at the top of the face or none at
  // the bottom. A mishit sheds speed, so only the low side is flagged.
  const MISHIT_FLOOR = 0.65;

  function summarize(shots, swingWt, qIn) {
    const ratios = shots.map(s => (s.vin && s.vout != null && isFinite(s.vout))
                                  ? s.vout / s.vin : null);
    const mid = median(ratios);
    const rows = shots.map((s, i) => {
      const status = classify(s);
      const raw = status === 'USE' ? pbcor(s.vin, s.vout, swingWt, qIn) : null;
      // Advisory only. It never changes the status and never leaves a shot out -- a
      // number is only dropped when a person types `x` in front of it.
      const suspect = status === 'USE' && mid != null && ratios[i] != null
                      && ratios[i] < MISHIT_FLOOR * mid;
      return { ...s, status, suspect, blockMedianRatio: mid,
               pRaw: raw, p50: raw == null ? null : correctTo50(raw, s.vin) };
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

  /* Split a PRE paste into the warm-up shots and the shots that make the measurement.
     Positional, before any gate: see the C.preWarmup note. `short` is how many shots are
     still missing from a full block, so a caller can say so rather than silently averaging
     three. Passing a warmup of 0 gives back the whole paste, which is what a pre-BUILD-3
     session and every existing fixture need. */
  function splitPre(shots, warmup) {
    const all = shots || [];
    const w = warmup == null ? C.preWarmup : Math.max(0, warmup);
    return { warmup: all.slice(0, w), block: all.slice(w),
             short: Math.max(0, w + C.preUsed - all.length) };
  }

  // ── the ball ──────────────────────────────────────────────────────────────
  // TWO REGIMES, SHARP BOUNDARY. Before a ball enters the KewCOR queue it takes exactly
  // 100 shots at 70 mph against a paddle clamped at 30 degrees — the accelerated wear
  // protocol, angled so it throws the spin-off durability testing measures. From the
  // moment it enters the queue every impact is 50 mph against a SQUARE, 90-degree clamp.
  // KewCOR itself is never measured at an angle.
  //
  // So a 70 mph wear shot counts for LESS than a 50 mph impact, not more: only the
  // square-on component compresses the core, and 70 x sin(30) = 35 mph.
  //
  // The protocol never varies, so this term is the same for every ball that has ever run
  // — a constant offset of about 44 impacts, which cannot rank one ball against another.
  // It does not reach a published KewCOR at all; see fixes_test.js #34.
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
  // AUTO ramps only when the ball is young enough for the move to BE wear, and
  // then only when PRE and POST differ by more than 2 standard errors.
  //
  // The t-test alone is not enough and shipping it alone was the bug. It asks
  // whether the control moved more than noise. It does not ask whether the move
  // was WEAR, and only wear licenses a ramp along the wear curve. Past
  // C.rampMaxAge the curve is flat, so a significant move is evidence of a
  // problem to investigate, not a gradient to apply. See the C.rampMaxAge note.
  function driftMode({ pre, post, forced, ballAge }) {
    if (forced === 'RAMP') return { mode: 'RAMP (forced)', ramp: true, t: null };
    if (forced === 'POOLED') return { mode: 'POOLED (forced)', ramp: false, t: null };
    if (!post || !post.n) return { mode: 'POOLED (no POST block yet)', ramp: false, t: null };

    const diff = post.mean - pre.mean;
    const sed = Math.sqrt(pre.se ** 2 + post.se ** 2);
    const t = diff / sed;
    const age = Number(ballAge);

    if (Number.isFinite(age) && age >= C.rampMaxAge) {
      const out = { mode: 'POOLED (ball is past the curve at ' + Math.round(age) + ' impacts)',
                    ramp: false, t, diff, sed, ballAge: age };
      // A control that moves hard on a ball with no decay left is how a cracked
      // ball, a fixture shift or a bad control block announces itself. Pooling
      // silently would hide exactly the session worth stopping to look at.
      if (Math.abs(t) > 2) {
        out.flag = 'The control moved ' + diff.toFixed(4) + ' (t = ' + t.toFixed(2)
                 + ') on a ball at ' + Math.round(age) + ' effective impacts, where the wear '
                 + 'curve leaves almost nothing to decay. That is not wear. Inspect the seam, '
                 + 'the fixture and the control blocks before trusting this session.';
      }
      return out;
    }

    return Math.abs(t) > 2
      ? { mode: 'RAMP (drift is real)', ramp: true, t, diff, sed, ballAge: age }
      : { mode: 'POOLED (drift is noise)', ramp: false, t, diff, sed, ballAge: age };
  }

  /* POOLED D — MID and POST set it. PRE does not, unless it is all there is.
   *
   * PRE is the first block of the day on a rested ball, and overnight recovery
   * puts it above the settled level. Across the five sessions of 2026-08-25 to
   * 09-01 it sat above the next control block by a mean of +0.0202 (sd 0.0214,
   * t = 2.11 on 4 df). Suggestive rather than settled at n = 5, but the pooling
   * rule does not depend on the size: a later, settled block is the better
   * estimate of the ball whether or not the recovery figure firms up.
   *
   * This used to pool PRE and POST by n, and MID was never pooled in at all even
   * when it had been shot. With no POST it fell back to PRE alone, the single most
   * contaminated block in the session. Both POOLED re-test reports of 2026-09-01
   * did exactly that: Zen S+ had MID n=8 at 0.3958 and no POST, so D came from PRE
   * at 0.4020 and shipped 0.4534. Pooling PRE and MID gives 0.4561; MID alone gives
   * 0.4588. The fallback moved the published number by 0.005.
   *
   * Keep shooting PRE. It is how the overnight change gets measured and how a bad
   * ball gets caught. It just should not set D when a settled block exists.
   *
   * BACKWARD COMPATIBILITY. Called as pooledD(pRef, pre, post) with no `mid` it
   * behaves exactly as it always did, pooling PRE and POST by n. That is what the
   * workbook does and what the fixtures assert, so the oracle still holds. The new
   * rule engages only when a `mid` is passed, which is what the runner now does.
   * Returns a NUMBER, as every caller expects. Use pooledSource() for provenance.
   */
  function pooledD(pRef, pre, post, mid) {
    if (mid === undefined) {                       // legacy path, matches the workbook
      const n1 = pre.n, n2 = post && post.n ? post.n : 0;
      const p0 = n2 ? (pre.mean * n1 + post.mean * n2) / (n1 + n2) : pre.mean;
      return D(pRef, p0);
    }
    return D(pRef, pooledSource(pre, post, mid).pCtrl);
  }

  // Which control blocks set D, and what they averaged to. Report-facing.
  function pooledSource(pre, post, mid) {
    const parts = [];
    if (mid && mid.n) parts.push({ name: 'MID', n: mid.n, mean: mid.mean });
    if (post && post.n) parts.push({ name: 'POST', n: post.n, mean: post.mean });
    const preOnly = parts.length === 0;
    if (preOnly) parts.push({ name: 'PRE', n: pre.n, mean: pre.mean });
    const n = parts.reduce((a, b) => a + b.n, 0);
    return { pCtrl: parts.reduce((a, b) => a + b.mean * b.n, 0) / n,
             from: parts.map(x => x.name).join('+'), n, preOnly };
  }

  // ── where each paddle and each location block sits in the ball's life ─────
  // Ages are measured in impacts. A block of shots characterizes the ball at its
  // own MIDPOINT, never at its start or end.
  function ballTimeline({ prior, wearShots, preFired, midFired, postFired, paddleShots,
                          midAfterPaddle, preWarmupFired }) {
    const base = effectiveAge(prior, wearShots);
    /* The block characterizes the ball at the midpoint of the shots that are USED. Warm-up
       shots age the ball but are not part of the measurement, so they push that midpoint
       later rather than averaging into it. preFired stays the TOTAL, because every one of
       those impacts happened. Omitted or zero reproduces the pre-BUILD-3 timeline exactly,
       which is what keeps the workbook oracle and the existing fixtures valid. */
    const warm = preWarmupFired > 0 ? Math.min(preWarmupFired, preFired) : 0;
    const agePre = base + warm + (preFired - warm) / 2;
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

  // ── ONE D PER PADDLE — A DELIBERATE, DOCUMENTED BIAS ──────────────────────
  // READ THIS BEFORE CHANGING ANYTHING HERE. This is not the unbiased choice and
  // was never claimed to be by anyone who checked. John's call, 2026-08-27, with
  // the cost on the table.
  //
  // Each location block used to get its own D, taken where that block was fired.
  // That was the CORRECTIVE, not the artifact. Locations are shot in order, 3 in
  // first, so the top of the face meets the freshest ball of that paddle and the
  // bottom meets the most worn one. Raw PBCoR is therefore inflated at 3 in and
  // deflated at 6 in. Per-block D compensates exactly: it adds least where the raw
  // is already high and most where it is low.
  //
  // On a flat-truth simulation — same true COR at every location, ball decaying on
  // the wear curve, zero measurement noise — the two methods return:
  //
  //     per-BLOCK   error  -0.0002 -0.0003 -0.0002 -0.0001   (flat, correct)
  //     per-PADDLE  error  +0.0093 +0.0026 -0.0029 -0.0075   (0.017 tilt)
  //
  // So one D per paddle leans the face map TOWARD THE TOP by about 0.017 across a
  // 3–6 in run. It moves peaks off 6 in, which is what John wanted, and it does it
  // by reintroducing a known bias rather than by removing one. Accepted because it
  // keeps new results comparable with the archive of old ones, which were computed
  // this way. It is not defensible as an unbiased face map and must never be
  // described as one — in a report, a client conversation, or a comment.
  //
  // The honest fix, if this ever needs to be unbiased again, is shooting the
  // locations in rotation (3,4,5,6, 3,4,5,6), which turns the gradient into a
  // common offset. That costs forty cannon moves per paddle and needs the
  // shot-to-location assignment reworked. See Design Notes.
  //
  // The ramp BETWEEN paddles stays. Paddle 1 and paddle 4 sat at genuinely
  // different points on the wear curve, that difference IS bracketed by measured
  // control blocks, and collapsing it would read paddle 1 low against paddle 4 —
  // on the ramp fixture, D 0.0224 against 0.0413, about 0.022 in KewCOR at 0.40.
  //
  // blockCounts is how many shots ACTUALLY landed in each location block, in firing
  // order. The workbook has to assume a fixed ten per block because it assigns shots
  // to locations by row position; the runner knows the real counts because each
  // location has its own box. Only the paddle's total matters now, so the two agree
  // wherever the totals do.
  function blockCorrections({ slot, tl, dPre, dMid, dPost, ramp, pooled,
                              shotsFired, nLocations, blockCounts }) {
    const counts = blockCounts || Array.from({ length: nLocations }, (_, i) =>
      Math.min(C.perLoc, Math.max(0, shotsFired - i * C.perLoc)));
    const n = nLocations || counts.length;
    if (!ramp) return Array.from({ length: n }, () => pooled);
    const start = tl.paddleStart[slot];
    const total = blockCounts ? counts.reduce((a, b) => a + b, 0) : shotsFired;
    const mid = start + total / 2;                  // the PADDLE's midpoint, once
    const seg = segmentFor(mid, tl, dPre, dMid, dPost);
    const f = curveFraction(mid - seg.a, seg.b - seg.a);
    const d = seg.Da + (seg.Db - seg.Da) * f;
    return Array.from({ length: n }, () => d);
  }

  // ── the published number ──────────────────────────────────────────────────
  // KewCOR = SQRT(PBCoR@50^2 + D), applied to the LOCATION MEAN — not shot by
  // shot, so a noisy individual shot cannot leak in through the square root.
  // shots is either a flat array (sliced into blocks of perLoc, as the workbook does)
  // or an array of per-location arrays, which is what the runner's separate paste
  // boxes give and which cannot be mis-assigned by an extra shot somewhere.
  /* `missed` is how many shots the speed gate failed to record at each location. They
     have no numbers, so they can never be `used`; they are counted in `impacts` because
     the ball aged for them. Keeping the two apart is the whole point: `used` drives the
     average, `impacts` drives the wear curve, and conflating them is wrong either way
     round. */
  function locationResults(shots, paddleLength, swingWt, locations, blockD, missed) {
    const grouped = Array.isArray(shots[0]);
    const miss = missed || [];
    return locations.map((loc, i) => {
      const qIn = qForLocation(paddleLength, loc);
      const slice = grouped ? (shots[i] || []) : shots.slice(i * C.perLoc, (i + 1) * C.perLoc);
      const s = summarize(slice, swingWt, qIn);
      const d = blockD[i];
      const m = Math.max(0, Math.round(Number(miss[i]) || 0));
      return {
        location: loc, q: qIn, fired: s.fired, used: s.n, meanVin: s.meanVin,
        missed: m, impacts: s.fired + m,
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

  return { BUILD, C, ANCHORS, effMass, pbcor, correctTo50, qForLocation, controlQ, strikeLocation,
           classify, summarize, median, MISHIT_FLOOR, splitPre,
           effectiveAge, D, curveFraction, driftMode, pooledD, pooledSource,
           ballTimeline, segmentFor,
           blockCorrections, locationResults, faceSummary, midAdvice, ballStage,
           BANDS, BAND_LO, BAND_HI, bandPosition, reportAxis, encodeReport, decodeReport };
}));
