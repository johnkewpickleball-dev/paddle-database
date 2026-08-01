/* ============================================================================
   PADDLE MATCHUPS DATA  (matchups.js)
   Lives in your GitHub Pages repo next to /images, served at:
     https://johnkewpickleball-dev.github.io/paddle-database/matchups.js
   The hub and the admin dashboard both read this one file.
   ORDER OF THIS ARRAY = ORDER THE CARDS APPEAR. Reorder with the admin dashboard.
   Do not hand-edit unless you want to; the admin dashboard exports this file for you.
   Fields per matchup:
     slug   : the page URL path after your domain, no leading slash (admin adds it)
     title  : card heading
     teaser : one-line hook
     chips  : up to 3 short tags
     date   : YYYY-MM-DD (drives the "New" badge and the "Added" label)
     search : lowercase keywords for the search box (paddle names, brands, shapes)
     imgA/imgB : optional paddle image slugs (for future use)
   ============================================================================ */
window.PADDLE_MATCHUPS = [
  {
    "slug": "11six24-ultre-power-2-vs-honolulu-j6cr-blue-grit",
    "title": "11SIX24 Ultré Power 2 vs Honolulu J6CR Blue Grit",
    "teaser": "Two of the only Tier 1 spin paddles, head to head. The spin is nearly a tie, so it comes down to shape, forgiveness, and price.",
    "chips": ["Hybrid vs Elongated", "Both Elite spin", "$199.99 vs $175.50"],
    "date": "2026-08-01",
    "search": "11six24 ultre ultré power 2 honolulu j6cr blue grit hybrid elongated tier 1 elite spin power",
    "imgA": "11six24-ultr-power-2",
    "imgB": "honolulu-pickleball-co-j6cr-blue-grit"
  }
];
