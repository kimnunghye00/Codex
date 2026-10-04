# browser-core 0.5

A browser-engine prototype built without Chromium, WebView2, or Firefox.

## Milestone 0.5: navigation

Version 0.5 turns the static renderer into an interactive browser prototype.

Current flow:

```text
HTTPS URL
   ↓
HTTP + redirects
   ↓
HTML → DOM
   ↓
CSS → computed styles
   ↓
Layout Tree
   ↓
click hit-testing
   ↓
URL resolution
   ↓
next HTTPS document
```

## Navigation now supported

- clickable `<a href="...">` text
- relative URL resolution
- absolute HTTPS links
- HTTP 301 / 302 / 303 / 307 / 308 redirects
- redirect loop detection
- maximum 8 redirects
- back history
- forward history
- F5 reload
- Alt+Left back
- Alt+Right forward
- visible back/forward buttons

Links are painted blue and underlined so supported interactive regions are visible.

## Low-memory history design

History stores URLs only.

It deliberately does **not** retain old DOM trees, CSS rule sets, computed style arrays, or layout trees. When going back or forward, browser-core reloads the target URL and replaces the current page objects.

This trades some network latency for a much smaller retained memory footprint.

History is capped at 256 URL entries.

## Navigation security policy

0.5 keeps the browser HTTPS-only.

The following are blocked:

- `http://` navigation
- redirects from HTTPS to HTTP
- `javascript:` links
- `data:` links
- `file:` links
- any other non-HTTPS scheme

Additional limits:

- maximum URL length: 8 KiB
- maximum redirects: 8
- redirect loop detection
- existing 2 MiB response limit
- existing network timeout
- existing DOM/CSS/layout limits

## Interaction

Mouse:

- click blue underlined link text to navigate
- click **<** or **>** in the top bar for history

Keyboard:

- **Alt+Left**: back
- **Alt+Right**: forward
- **F5**: reload
- **Esc**: close

## Current limitations

- no editable address bar yet
- fragment scrolling (`#section`) is not implemented
- forms are not interactive
- external stylesheets are not downloaded
- images are not downloaded
- JavaScript is not executed
- history reloads pages instead of keeping a back-forward cache
- no cookies or persistent storage

## Run on Windows

```powershell
cd browser-engine
cargo run --release -- https://example.com
```

## Next milestone

0.6 should add a real editable address bar, scrolling, external CSS loading, and image-resource fetching with strict per-page memory budgets.
