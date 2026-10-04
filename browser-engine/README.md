# browser-core 0.3

A browser-engine prototype built without Chromium, WebView2, or Firefox.

## Milestone 0.3: our own CSS + style engine

Version 0.3 keeps the compact DOM from 0.2 and adds an author CSS parser plus computed-style pass.

Current flow:

```text
HTTPS URL
   ↓
TCP + TLS
   ↓
our HTTP/1.1 parser
   ↓
our HTML parser
   ↓
compact DOM arena
   ↓
our CSS parser
   ↓
computed-style array
   ↓
style-aware text renderer
```

## Supported CSS in 0.3

Selectors:

- element selectors such as `p` and `h1`
- class selectors such as `.note`
- id selectors such as `#hero`
- compact combinations such as `p.note#hero`
- comma-separated selector groups

Properties:

- `display: none | inline | block`
- `color`
- `background` / `background-color`
- `font-size`
- `margin-top`
- `margin-bottom`
- `padding-top`
- `padding-bottom`

Lengths:

- `px`
- `em`
- `rem`

Colors:

- `#rgb`
- `#rrggbb`
- a small built-in set of named colors

Inline `style="..."` declarations are also supported and win over stylesheet rules.

## Cascade implemented

The engine now handles:

- selector specificity
- source order
- inherited text color
- inherited font size
- browser default styles for headings, paragraphs, and block elements
- `display:none` suppression

The style engine stores one fixed-size `ComputedStyle` entry per DOM node instead of copying the DOM.

## Memory / security limits

Existing protections remain:

- HTTPS only
- certificate verification enabled
- 2 MiB HTTP response limit
- 10-second socket timeout
- maximum 100,000 DOM nodes
- maximum DOM depth of 1,024
- maximum 256 HTML attributes per element

New CSS limits:

- maximum 256 KiB embedded CSS
- maximum 4,096 CSS rules
- maximum 64 selectors per rule
- maximum 128 declarations per rule
- maximum 4 KiB inline style attribute

Unsupported complex selectors are ignored rather than partially interpreted.

## Renderer status

The renderer now reacts to computed styles:

- text color
- font size
- body background color
- block/inline flow
- vertical margins and padding
- `display:none`

This is still deliberately not a full box-layout engine. Exact widths, horizontal margins/padding, borders, flexbox, grid, positioning, and external stylesheets come later.

## Run on Windows

```powershell
cd browser-engine
cargo run --release -- https://example.com
```

Press **Esc** to close.

## Next milestone

0.4 should be the first real layout engine: block boxes, inline text boxes, width calculation, horizontal padding/margins, backgrounds tied to actual boxes, and viewport-aware layout.
