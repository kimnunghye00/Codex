# browser-core 0.4

A browser-engine prototype built without Chromium, WebView2, or Firefox.

## Milestone 0.4: our own layout engine

Version 0.4 separates page geometry from painting. The renderer no longer decides where text goes while drawing it. A dedicated layout pass first converts styled DOM nodes into boxes and text fragments with fixed coordinates.

Current flow:

```text
HTTPS URL
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
our Layout Tree
   ↓
our pixel renderer
```

## Layout model in 0.4

Each laid-out element can now have:

- x / y
- width / height
- content rectangle
- block or inline participation
- vertical and horizontal margin
- vertical and horizontal padding
- background rectangle

Text is converted into bounded text fragments before rendering. Wrapping happens during layout rather than during painting.

The renderer consumes those precomputed rectangles and does not walk the DOM to decide geometry.

## CSS box improvements

0.4 adds:

- `margin-left`
- `margin-right`
- `padding-left`
- `padding-right`
- 1-4 value `margin` shorthand
- 1-4 value `padding` shorthand

For example:

```css
.card {
  margin: 10px 20px;
  padding: 8px 16px;
  background-color: #eeeeee;
}
```

now changes the actual box and content width.

## Memory and security design

The layout result is stored in compact arrays indexed by the same 32-bit DOM NodeId values.

Safety limits now include:

- maximum layout recursion depth: 256
- maximum generated text fragments: 200,000
- saturating coordinate arithmetic
- zero-width viewport rejection
- `display:none` subtrees excluded before fragment generation

Existing network, DOM, and CSS limits remain in place.

## Current limitations

This is intentionally a small block/inline formatting model, not the full CSS formatting specification.

Not implemented yet:

- margin collapsing
- borders
- explicit CSS width / height
- floats
- absolute / fixed positioning
- flexbox
- grid
- tables as a special layout algorithm
- scrolling
- images
- external stylesheets
- JavaScript

Inline backgrounds use the bounding rectangle of their current laid-out contents rather than the full CSS inline-fragment painting rules.

## Run on Windows

```powershell
cd browser-engine
cargo run --release -- https://example.com
```

Press **Esc** to close.

## Next milestone

0.5 should make pages interactive: links with hit-testing, URL resolution, navigation, redirect handling, and back/forward history.
