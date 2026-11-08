# sitereel

Turn any website into a **smooth, studio-quality scroll video**: 60 fps, up to 4K, in widescreen, vertical (Reels/TikTok) or square.

sitereel doesn't screen-record. It **freezes the website's clock** and renders the video one frame at a time, advancing animations, smooth scrolling and background videos by exactly 1/60 s per frame. Nothing can lag, drop frames or stutter, however heavy the site is.

---

## 1. Install (once)

You need:

- **Node.js 18 or newer**: <https://nodejs.org>
- **Google Chrome** (recommended, so videos on the site play in the recording). Microsoft Edge also works.

Then, in this folder:

```bash
npm install
```

Optional: make `sitereel` a command you can run from anywhere:

```bash
npm link
```

(Without `npm link`, use `node bin/sitereel.js` wherever this guide says `sitereel`.)

---

## 2. Quick start

```bash
# Record a whole page — sitereel finds the sections and pauses on them by itself
sitereel https://example.com

# Several pages, joined with crossfades
sitereel https://example.com --pages "/,/about,/contact"

# Check the timing first with a fast, low-res draft (~1 minute)
sitereel https://example.com --pages "/,/about" --draft

# Vertical video for Instagram Reels / TikTok (uses the site's phone layout)
sitereel https://example.com --format 9:16

# 4K
sitereel https://example.com --quality 4k
```

The video is saved in the current folder (or wherever `--out` says).

### Recommended workflow

1. Run with `--draft`. It takes about a minute and shows you the path, pauses and timing.
2. Adjust the settings (speed, pauses, pages, actions).
3. Run again without `--draft` for the final 1080p/4K, 60 fps video.

---

## 3. Settings file (full control)

Create a starter file:

```bash
sitereel init https://example.com     # writes sitereel.json
```

Edit it, then:

```bash
sitereel --config sitereel.json
```

Command-line flags override the file, e.g. `sitereel --config sitereel.json --draft`.

### Example

```json
{
  "url": "https://example.com",
  "format": "16:9",
  "quality": "1080p",
  "fps": 60,
  "speed": "medium",
  "transition": { "type": "crossfade", "duration": 0.8 },
  "hide": [".cookie-banner", "#chat-widget"],
  "pages": [
    { "path": "/" },
    { "path": "/work/project-one", "pauseOn": ["h2", ".gallery"] },
    {
      "path": "/about",
      "actions": [
        { "scrollTo": "#services", "offset": 60 },
        { "hold": 1 },
        { "click": "#services .tab:nth-child(2)" },
        { "hold": 2 },
        { "scrollTo": "bottom" }
      ]
    },
    { "path": "/contact", "speed": "slow" }
  ]
}
```

More examples are in [`examples/`](examples/):

| File | Shows |
|---|---|
| `simple.json` | the minimum: one page, auto mode |
| `multi-page.json` | 4 pages, pauses on chosen sections, clicking an accordion, crossfades |
| `instagram-vertical.json` | 9:16 phone layout, faster pace, cut transition |
| `logged-in.json` | logging in first, with the password taken from an environment variable |

### All settings

| Setting | Values | Default | What it does |
|---|---|---|---|
| `url` | address | — | The website. Page paths are relative to it. |
| `pages` | list | just `url` | Pages to record, in order. A path (`"/about"`) or an object (see below). |
| `format` | `16:9` `9:16` `1:1` `4:5` | `16:9` | 16:9 = 1920×1080 · 9:16 = 1080×1920 (phone layout) · 1:1 = 1080×1080 · 4:5 = 1080×1350 |
| `width` / `height` | pixels | — | Custom browser size instead of a format (with `"scale"` for output resolution). |
| `quality` | `1080p` `4k` | `1080p` | 4K doubles the resolution. |
| `fps` | `30` `60` (also 24, 25, 50) | `60` | Frames per second. |
| `speed` | `slow` `medium` `fast` or a number | `medium` | Scroll speed. A number = pixels per second. |
| `transition` | `"crossfade"` `"cut"` or `{ "type", "duration" }` | crossfade 0.8 s | Between pages. |
| `startHold` | seconds | `2.5` | Wait at the top of each page so intro animations can play. |
| `endHold` | seconds | `1.5` | Hold at the end of each page. |
| `pause` | seconds | `0.9` | Pause at each section. |
| `autoPauses` | true/false | `true` | Find sections and headings automatically and pause on them. |
| `fullPage` | true/false | `true` | Scroll to the bottom of each page (auto mode). |
| `hide` | list of CSS selectors | `[]` | Elements to hide (banners, chat bubbles, pop-ups). |
| `hideCommonPopups` | true/false | `true` | Hide well-known cookie banners and chat widgets automatically. |
| `css` | CSS text or a `.css` file | — | Extra styling injected into every page. |
| `mobile` | true/false | on for 9:16 | Pretend to be a phone (touch + mobile browser). |
| `scrollMode` | `auto` `wheel` `native` | `auto` | `wheel` for smooth-scroll sites (Lenis, Locomotive), `native` for normal sites. Auto-detected. |
| `auth` | object | — | Logged-in pages. See section 5. |
| `browser` | `auto` `chrome` `msedge` `chromium` | `auto` | Which browser records. |
| `headed` | true/false | `false` | Show the browser window while recording. |
| `draft` | true/false | `false` | Fast preview: half size, 15 fps. |
| `out` | file path | auto-named | Where to save the video. |
| `keepFrames` | true/false | `false` | Keep the individual frames (for editing). |
| `timeout` | seconds | `90` | How long to wait for a page to load. |

### Per-page settings

Each entry in `pages` can be a path string or an object with:

| Key | What it does |
|---|---|
| `path` or `url` | The page (`url` for a full address on another site). |
| `pauseOn` | List of selectors to pause on, instead of automatic sections. |
| `actions` | Exact list of steps (see below). Replaces the automatic scroll. |
| `speed`, `pause`, `startHold`, `endHold`, `autoPauses`, `fullPage` | Override the global value for this page. |
| `hide`, `css` | Extra hiding/styling for this page only. |

### Actions

Use `actions` when you want to direct the "camera" yourself:

| Action | Example | What happens |
|---|---|---|
| `scrollTo` | `{ "scrollTo": "#pricing", "offset": 80 }` | Smoothly scroll to an element (`offset` = stop that many pixels above it). Also `"top"`, `"bottom"` or a number of pixels. |
| `scrollBy` | `{ "scrollBy": 600 }` | Scroll down (or up, if negative) by a number of pixels. |
| `hold` | `{ "hold": 1.5 }` | Pause for 1.5 seconds. |
| `click` | `{ "click": ".tabs button:nth-child(2)" }` | Click an element (tabs, accordions, sliders…). |
| `hover` | `{ "hover": ".card:first-child" }` | Move the (invisible) mouse over an element to show hover effects. |
| `type` | `{ "type": "#email", "text": "hi@site.com", "cps": 12 }` | Type into a field, letter by letter (`cps` = characters per second). |
| `waitFor` | `{ "waitFor": ".loaded" }` | Wait until an element appears. |

Any action can take `"speed"` (for example `"slow"` or `250`) to override the scroll speed.

---

## 4. Command-line options

```
sitereel <url> [options]
sitereel --config <file> [options]
sitereel init [url]

-c, --config <file>        settings file
-p, --pages <list>         "/,/about,/contact"
-f, --format <f>           16:9 | 9:16 | 1:1 | 4:5      (--width/--height for custom)
-q, --quality <q>          1080p | 4k
    --fps <n>              30 | 60
-s, --speed <s>            slow | medium | fast | <pixels per second>
-t, --transition <t>       crossfade | cut
    --crossfade <sec>      crossfade length
    --pause <sec>          pause at each section
    --no-auto-pauses       scroll without pausing on sections
    --start-hold <sec>     wait at the top of each page
    --end-hold <sec>       hold at the end of each page
    --hide <selector>      hide an element (repeat for more)
    --css <css|file.css>   extra CSS
    --cookies <file>       cookies for logged-in pages
    --storage-state <file> Playwright session file
    --mobile               emulate a phone
    --scroll-mode <m>      auto | wheel | native
    --browser <b>          auto | chrome | msedge | chromium
    --headed               show the browser window
    --draft                fast preview
-o, --out <file.mp4>       output file
    --keep-frames          keep the frames
```

---

## 5. Logged-in pages

Three ways, in a settings file under `"auth"`:

**a) Log in automatically**

```json
"auth": {
  "login": {
    "url": "https://app.example.com/login",
    "steps": [
      { "fill": "input[type=email]", "value": "$ENV:SITE_EMAIL" },
      { "fill": "input[type=password]", "value": "$ENV:SITE_PASSWORD" },
      { "click": "button[type=submit]" },
      { "waitForUrl": "**/dashboard" }
    ]
  }
}
```

`$ENV:NAME` reads the value from an environment variable, so passwords never sit in the file:

```bash
# Windows PowerShell
$env:SITE_EMAIL="me@site.com"; $env:SITE_PASSWORD="…"; sitereel --config app.json
# Mac / Linux / Git Bash
SITE_EMAIL=me@site.com SITE_PASSWORD=… sitereel --config app.json
```

Login steps: `fill` + `value`, `click`, `press` (a key), `waitFor` (selector), `waitForUrl`, `wait` (seconds), `goto`.

**b) Cookies:** `"auth": { "cookies": "cookies.json" }` or `--cookies cookies.json`. Accepts the JSON exported by browser cookie extensions (for example "Cookie-Editor").

**c) Session file:** `"auth": { "storageState": "state.json" }`, a Playwright storage-state file.

Optional: `"auth": { "localStorage": { "key": "value" } }` sets local storage before the page loads (handy to pre-accept cookie banners).

> Cookie and session files are private. They're already excluded from git (`.gitignore`).

---

## 6. Tips

- **Cookie banners and chat bubbles** are hidden automatically. Hide anything else with `"hide": [".selector"]`. To find a selector, right-click the element in Chrome, choose **Inspect**, and look at its `id` or `class`.
- **Pacing:** `slow` for luxury and portfolio sites, `fast` for social media. Increase `pause` to let viewers read.
- **Smooth-scroll sites** (Lenis, Locomotive Scroll, GSAP ScrollSmoother) are detected automatically and scrolled the way they expect.
- **Bot protection:** some hosts (Cloudflare, Vercel's security checkpoint) block automated browsers. If you see a warning about a bot check, try `--headed`, provide cookies, or record a local copy of the site (`npm run dev` / `npm start`, then `sitereel http://localhost:3000`).
- **Disk space:** frames are stored temporarily while rendering, about 1–2 GB for a 2-minute 1080p video and about 4× that for 4K. They're deleted automatically at the end.

### Render time (typical)

| Video | Draft | 1080p 60 fps | 4K 30 fps |
|---|---|---|---|
| 30 s | ~20 s | ~4 min | ~4 min |
| 2 min | ~1–2 min | ~15 min | ~15 min |

Your computer does the work, and nothing is uploaded anywhere.

---

## 7. Limitations

- **Embedded YouTube/Vimeo players and other iframes** aren't controlled by the frozen clock and may look still or jump.
- **3D/WebGL effects** that keep their own timing (rare) may not be perfectly smooth.
- **Background videos** need Google Chrome or Edge (the built-in Chromium can't play MP4).
- **Infinite-scroll pages** keep growing; use `actions` with `scrollBy` instead of scrolling to the bottom.

---

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| `No browser found` | Install Google Chrome, or run `npx playwright install chromium`. |
| Background video looks frozen | Use Chrome or Edge (`--browser chrome`). |
| A pop-up or banner shows in the video | Add its selector to `hide`. |
| `Not found on page: …` | The selector doesn't exist on that page. Check it with Chrome's Inspect tool. |
| Page never stops loading | sitereel continues after `timeout` seconds. Raise it with `"timeout": 150` if content is missing. |
| Bot-check warning | See "Bot protection" in Tips. |
| Need a different video encoder | Set `SITEREEL_FFMPEG=/path/to/ffmpeg`. |

---

## How it works (for developers)

1. **Playwright** opens the page in Chrome. Before the site's code runs, sitereel replaces `requestAnimationFrame`, `performance.now` and `Date.now` with a virtual clock, and takes control of CSS/Web Animations and `<video>` elements.
2. For every frame it advances the clock by 1/fps, applies the scroll for that frame (wheel events for smooth-scroll libraries, `scrollTop` otherwise), runs the page's animation callbacks, and captures the visible area directly from Chrome at the output resolution.
3. Scrolls use a natural motion curve: smooth acceleration, steady glide, smooth stop.
4. **ffmpeg** encodes each page to a clip and joins the clips with crossfades (blend) or cuts, then exports an H.264 MP4 that plays everywhere.

Code: `bin/sitereel.js` (command line) · `src/config.js` (settings) · `src/page-runtime.js` (runs inside the page) · `src/recorder.js` (browser and actions) · `src/encoder.js` (video).
