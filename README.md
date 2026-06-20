# Pickleball Paddle Database

The interactive paddle database for **[johnkewpickleball.com](https://www.johnkewpickleball.com/)**.

`index.html` is a single, self-contained web app (HTML + CSS + JavaScript, no build step). It is hosted on **GitHub Pages** and embedded into the Squarespace site via an iframe. All paddle data is pulled **live** from a published Google Sheet each time the page loads, so updating the sheet updates the site — no code changes needed.

- **Live app:** https://johnkewpickleball-dev.github.io/paddle-database/
- **On the site:** https://www.johnkewpickleball.com/paddle-database

---

## Repo contents

| Path | What it is |
|------|------------|
| `index.html` | The paddle database app. Deploy this as the repo's root page. |
| `images/` | Paddle photos (you create this folder — see below). |

---

## How the data works

The app fetches a **published CSV** of the Google Sheet at load time (with a CORS-proxy fallback). To change what appears on the site, just edit the sheet:

- **Source sheet:** https://docs.google.com/spreadsheets/d/1ukZFKMasomu1NKcILe6VqQrDLciQj_BhMfWshSy8MaI/edit (tab `gid=575894669`)
- Add, edit, or remove paddle rows in the sheet → the changes appear on the next page load.

No deploy is required for data changes. You only re-deploy `index.html` when you change the app itself.

---

## Adding paddle photos

Photos load automatically from the `images/` folder by a filename convention. A photo only appears if its file exists — paddles without a photo simply show no image (no placeholder, no empty box).

**Naming rule:** lowercase the `Company` + `Paddle`, join with a hyphen, replace any run of non-letter/number characters with a single hyphen, and use `.jpg`.

| Company | Paddle | Filename |
|---------|--------|----------|
| Six Zero | Coral-Hybrid | `six-zero-coral-hybrid.jpg` |
| 11SIX24 | Hurache-X Power 2 | `11six24-hurache-x-power-2.jpg` |
| Bread & Butter | Filth Hybrid | `bread-butter-filth-hybrid.jpg` |

**Steps:**
1. Create an `images/` folder in this repo (if it doesn't exist yet).
2. Name each photo per the rule above and save it as `.jpg`. The file **`paddle-image-filenames.csv`** lists the exact filename for every current paddle.
3. Commit and push. Photos appear on the database cards/modal **and** the Comparison Lab automatically.

**Tip:** square-ish or 16:10 images look best; they're displayed with `object-fit: contain`, so nothing gets cropped.

**Exceptions / overrides:** to use a different filename, a `.png`, or an external URL for one paddle, add an entry to the `PHOTO_URLS` object near the top of the script:

```js
const PHOTO_URLS = {
  "Six Zero||Coral-Hybrid": "https://.../coral-special.png"
};
```

---

## Configuration (top of the `<script>` in `index.html`)

| Setting | Purpose |
|---------|---------|
| `PHOTO_BASE` | Base URL for paddle images. Default: `https://johnkewpickleball-dev.github.io/paddle-database/images/`. Switch to a CDN like jsDelivr here if desired. |
| `LAB_URL` | Address of the **Paddle Comparison Lab** page. Used by the "Compare This Paddle…" button. Set this to wherever the Lab is published. |
| `CSV_URL` | The published Google Sheet CSV the app reads. |

---

## Features

- Live data from Google Sheets with grid and list views, pagination, and search.
- Filters: dual-handle range sliders (Price, Swing Weight, Twist Weight) and multi-select category chips (Shape, Build, Handle Length, Core Thickness, Spin Rating, Performance Profile, Firepower Balance).
- Correct discount handling — recognizes dollar-off vs percent-off, plus Selkirk's tiered digital gift-card promo.
- Detailed modal per paddle with performance, specs, and details.
- **Compare This Paddle…** button that opens the Comparison Lab pre-loaded with that paddle.
- Auto paddle photos (shown only when an image exists).

---

## Related pages (hosted on Squarespace, not in this repo)

These are separate Squarespace Code-block pages that share this project's data and image convention:

- **Paddle Comparison Lab** — compare 2–3 paddles side by side (summary cards, radar of scaled Z-scores, full specs). Reads images from this repo's `images/` folder via the same naming rule.
- **Paddle Raw Data** — the full dataset as a sortable, filterable table.
- **Discount Codes** — affiliate partners and discount codes.

---

## Deploying a code change

1. Edit `index.html`.
2. Commit and push to the branch GitHub Pages serves (typically `main`).
3. GitHub Pages updates within a minute or two; the embedded Squarespace iframe picks it up automatically.
