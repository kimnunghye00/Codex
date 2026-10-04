# browser-core 0.1

A first-step browser engine prototype built without Chromium, WebView2, or Firefox.

## What this version does

1. Accepts an HTTPS URL.
2. Opens a TCP connection.
3. Performs TLS with `rustls` and Mozilla-compatible Web PKI roots.
4. Writes an HTTP/1.1 GET request itself.
5. Parses the HTTP status line, headers, Content-Length, and chunked transfer encoding itself.
6. Converts basic HTML into visible text with our own small parser.
7. Draws that text into a native pixel window with our own text-layout loop.

Default target:

```text
https://example.com
```

## Run on Windows

Install the current stable Rust toolchain, then:

```powershell
cd browser-engine
cargo run --release -- https://example.com
```

Press **Esc** to close.

## Security / memory rules already present

- HTTPS only.
- Certificate verification stays enabled.
- No JavaScript.
- No cookies.
- No browser extensions.
- No filesystem API exposed to pages.
- No camera, microphone, geolocation, USB, Bluetooth, or clipboard APIs.
- 10-second socket read/write timeout.
- 2 MiB maximum HTTP response size.
- `Accept-Encoding: identity` to avoid decompression-bomb handling in this stage.
- CSS and JavaScript source are not rendered as page text.

## Intentionally not implemented yet

This is not a general-purpose browser yet. It does not currently support:

- redirects
- HTTP/2 or HTTP/3
- real DOM construction
- CSS layout
- images
- links/clicking
- forms
- Unicode font rendering
- JavaScript
- tabs
- persistent storage

The next engine milestone is a real DOM tree parser instead of the current text extractor.
