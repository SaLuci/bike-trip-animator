# 🚴 Bike Trip Animator

A mobile-friendly web app that turns your daily GPX bike rides into an animated,
cartoon-style map video for Instagram Stories — built for a Germany → Italy bike trip.

It runs entirely in the browser (no backend, no account, no upload to any server) so your
GPX tracks never leave your phone. Once opened once, it also works offline (see below).

## What it does

- **📁 Previous Days** — upload none/one/many GPX files. Drawn as a solid, lighter-red line
  (already ridden).
- **📍 Current Day** — upload one or more GPX files for today. These are concatenated (in
  filename order) into a single route and **animated** stroke-by-stroke across the map, in red.
- **🗺️ All Days** — upload none/one/many GPX files for the full planned route. Used to
  compute total trip distance, and to animate the remaining route (see below).
- **🏷️ Title** — a short label (e.g. "Day 5") shown in a pill at the top-center of the map.
- **🚩 Start City / 🏁 End City** — text labels pinned at the first and last point of the
  current day's route.
- **⚡ Animation Speed** — a slider (0.5x–2.5x) that speeds up or slows down every
  animation in the video.
- **🎬 Animate** — records the animation live to a real video file (MP4 where the browser
  supports it, WebM otherwise — no more GIFs, so it actually works as an Instagram Story!)
  and lets you save it (native "Save As" dialog where supported, otherwise a normal
  browser download).

### The animation sequence

1. The camera zooms in to follow just today's route as it draws in red (previous days stay
   visible, in a lighter red, the whole time).
2. Once today's distance finishes counting up, a small "explosion" bursts around the **km
   ridden** number to celebrate the day's total.
3. The camera eases back out to reveal the whole trip so far, while a dashed line animates
   open starting from *where today's ride ended* and drawing all the way to the final
   destination — the road still ahead. The **km remaining** counter only appears once this
   reveal starts.
4. The rider marker faces the direction it's heading (left when riding west-ish, right when
   riding east-ish).

The basemap is a hand-drawn-style "cartoon" map (not real map tiles) built from
public-domain Natural Earth data — a different color per country with their real (not
smoothed) borders, country names, a couple dozen major European cities, a handful of major
rivers/lakes, sea names, and prominent Alps mountain glyphs.

## Running it

Requires [Node.js](https://nodejs.org/) (already installed for you) and internet access
only for the one-time `npm install`.

```powershell
npm install       # first time only
npm run dev       # start a local dev server, prints a http://localhost:5173 URL
```

Open that URL in a phone browser on the same Wi-Fi (or `npm run dev -- --host` to expose
it on your network) to try it on your phone right away.

To create an optimized build you can host anywhere:

```powershell
npm run build     # outputs static files into dist/
npm run preview   # serve the built dist/ folder locally to double check it
```

## Using it daily on your phone while traveling

`dist/` is a folder of plain static files — host it once wherever is easiest for you
(GitHub Pages, Netlify, Vercel, or any static host all have free tiers), then just open
that URL on your phone each day. A couple of tips:

- **Add it to your home screen** (Safari/Chrome share/menu → "Add to Home Screen"). It has
  a manifest + icon so it installs like a lightweight app.
- After the first visit, a service worker caches the app, so it keeps working **offline**
  even with no signal — handy mid-ride in the mountains.
- Saving the video: on desktop/Android Chrome you'll get a native "Save As" dialog. On iOS
  Safari (which doesn't support that API yet) it falls back to a normal download; you can
  also just long-press the preview video and "Save to Photos".

## Deploying to GitHub Pages

A GitHub Actions workflow ([.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml))
is already set up: on every push to `main` it runs `npm run build` and publishes `dist/`
to GitHub Pages automatically. You just need to, once:

1. Push this repo to GitHub (see the chat walkthrough for account/credential setup).
2. In the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main` (or re-run the workflow from the **Actions** tab) — your site goes live
   at `https://<username>.github.io/<repo>/`.

Note: free GitHub plans generally require the repo to be **public** for Pages to serve it
(the deployed site is publicly reachable at that URL either way, even from a private
repo on a paid plan) — this app has no secrets in it, so a public repo is usually fine.

## Notes / assumptions

- Multiple files in the same upload box are sorted by filename (numeric-aware) before
  being used, so name your daily GPX exports so they sort chronologically (e.g. include
  the date).
- The map is fit to whichever data is most complete: the "All Days" route if provided,
  otherwise previous+current days, otherwise a default Germany→Italy view.
- Distances use the Haversine formula over each file's track points.
- The video is recorded live from the canvas via the browser's `MediaRecorder` API (no
  extra encoder library), so generating it takes about as long as the animation itself
  (roughly 8–10 seconds at 1x speed).
- Output size, animation timing, colors, and the lists of cities/rivers/lakes are all easy
  to tweak in [src/constants.ts](src/constants.ts) and [src/geoFeatures.ts](src/geoFeatures.ts).
