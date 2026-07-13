// bot-defense-1 — Cloudflare Worker in front of the paddle database's data endpoints.
// Live at: https://bot-defense-1.johnkewpickleball.workers.dev/
//
// NOT auto-deployed. This file is a reference copy for version history/diffing only — to
// actually ship a change: Cloudflare dashboard > Workers & Pages > bot-defense-1 > Edit code >
// select all > paste this file's contents > Save > Deploy > Manage deployments > New Version.
// Requires the APPS_SCRIPT_URL environment variable to already be set (Settings > Variables).
//
// Two jobs:
//  1. CSV proxy (GET) — fetches the three published Google Sheet CSVs server-side and returns
//     them, so the raw Sheet URLs never appear in the site's page source (they can't be found
//     and subscribed to independently of the app). Routes are fixed/hardcoded below — this is
//     intentionally NOT a generic "?url=" open proxy; it will only ever fetch these three URLs.
//     Responses are cached at the edge for CACHE_SECONDS to cut Google Sheets quota risk and
//     speed up repeat loads.
//  2. Stats/votes proxy (POST) — unchanged from before: forwards view/labadd/vote calls to the
//     Apps Script backend, stamping the real Cloudflare-verified client IP onto the payload.

const CSV_SOURCES = {
  '/csv/paddles': 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSxXXe0qvh94nPoU20S7OSp8yw9tHF4f4VpfNH_fneBhKSSOxvvrQ9lPGwgcNa_OS9OuWTZzaDyZWiZ/pub?gid=575894669&single=true&output=csv',
  '/csv/surface': 'https://docs.google.com/spreadsheets/d/1yUySVb0Vex9qWq5pxspFy9eJoa1OEfWzVl-x-sCKBkw/gviz/tq?tqx=out:csv',
  '/csv/feel':    'https://docs.google.com/spreadsheets/d/1QEAK3G59VBq4uYIh73fqc59fbdbZiqo-8uIfrf4qACI/gviz/tq?tqx=out:csv',
};
const CACHE_SECONDS = 60;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ---- 1) CSV proxy ----
    if (request.method === 'GET' && CSV_SOURCES[url.pathname]) {
      const cache = caches.default;
      const cacheKey = new Request(url.toString(), request);
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      const upstream = await fetch(CSV_SOURCES[url.pathname]);
      const body = await upstream.text();
      const resp = new Response(body, {
        status: upstream.status,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
        },
      });
      if (upstream.ok) ctx.waitUntil(cache.put(cacheKey, resp.clone()));
      return resp;
    }

    // ---- 2) Stats/votes proxy (unchanged) ----
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    let payload;
    try { payload = await request.json(); }
    catch (e) { return new Response(JSON.stringify({ ok:false, error:'bad json' }), { status:400 }); }

    payload.ip = ip; // real, server-verified — the client can't spoof or omit this

    const BLOCKED_IPS = new Set([ /* '1.2.3.4', */ ]);
    if (BLOCKED_IPS.has(ip)) {
      return new Response(JSON.stringify({ ok:false, error:'blocked' }), { status:403 });
    }

    const upstream = await fetch(env.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    return new Response(await upstream.text(), { status: upstream.status });
  }
};
