# browser-core 0.7

A browser-engine prototype built without Chromium, WebView2, or Firefox.

## Milestone 0.7: renderer process isolation

Version 0.7 moves untrusted document processing out of the long-lived browser UI/network process.

The browser now has two roles:

\`\`\`text
Privileged browser broker
  - HTTPS / certificate validation
  - redirects
  - resource byte budgets
  - address bar / history / window
  - fetches main document and approved HTTPS subresources
             |
             | bounded binary IPC
             v
Ephemeral renderer worker
  - HTML parser / DOM
  - CSS parser / style engine
  - PNG/JPEG decoding
  - layout
  - creates a flat RenderPacket
             |
             v
worker exits
\`\`\`

The broker keeps only the final paint data needed for the current page: rectangles, text fragments, decoded image pixels, link targets, background, and content height. It no longer retains the page DOM, stylesheet, or layout tree after a load finishes.

## Windows containment

Before the broker sends any untrusted document bytes, the worker is assigned to a Windows Job Object.

Current enforced limits:

- one active process in the renderer job
- 192 MiB process committed-memory cap
- 10 seconds of user-mode CPU time per renderer process
- kill the renderer when its Job Object closes
- terminate on unhandled exceptions without crash-dialog interaction
- block access to USER handles owned by other processes
- block clipboard read/write
- block display-settings changes
- block system-parameter changes
- isolate global atoms
- block desktop creation/switching
- block ExitWindows calls

The worker starts by blocking on stdin. Job Object limits are attached before the broker writes HTML into the IPC channel.

## Narrow IPC protocol

The renderer cannot request arbitrary broker operations.

The protocol has four bounded stages:

1. LOAD: base URL, viewport width, and at most 2 MiB of HTML.
2. SCAN: up to 8 stylesheet references and 12 image references.
3. RSRC: broker-fetched HTTPS CSS/image bytes within the existing resource budgets.
4. RNDR: bounded flat paint data.

Every IPC vector/string/byte field has count or size validation before allocation.

Link clicks are returned as raw href strings. The privileged broker resolves and re-validates them with the HTTPS-only URL policy before navigation.

## Memory behavior

The renderer is intentionally ephemeral.

During page loading there are two processes, but after layout/painting data is produced the renderer exits and releases its DOM, CSS parser, style engine, layout tree, encoded resources, and temporary decode buffers.

The long-lived browser process retains only:

- current URL
- URL-only back/forward history
- flat render rectangles/text
- current decoded image pixels
- the fixed-size window framebuffer

This is designed to keep inactive parser state out of steady-state memory.

## Important security boundary

0.7 is stronger process containment, but it is **not yet a complete browser sandbox**.

Windows Job Objects provide resource/process/UI restrictions, but this milestone does not yet create a restricted security token or AppContainer. Therefore the renderer's operating-system filesystem and network rights are not yet fully removed at the token level.

The intended renderer code path has no network operation: it asks the broker for bounded resources through IPC. OS-enforced denial of renderer network/filesystem access is the next security milestone.

## Existing policies remain

- HTTPS only
- certificate validation enabled
- HTTP downgrade redirects blocked
- javascript/data/file URL schemes blocked
- embedded-credential URLs blocked
- no JavaScript execution
- no cookies
- no extensions
- bounded DOM/CSS/layout/image resources
- URL-only navigation history

## Next milestone

0.8 should harden the renderer identity itself with a restricted Windows token / AppContainer-style capability model, explicitly deny renderer network access, narrow filesystem access, and separate the renderer executable to reduce its linked attack surface.
