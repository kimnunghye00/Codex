# browser-core 0.2

A browser-engine prototype built without Chromium, WebView2, or Firefox.

## Milestone 0.2: our own DOM

The first version only stripped tags. Version 0.2 now parses HTML into an in-memory DOM tree owned by this project.

Flow:

```text
HTTPS URL
   ↓
TCP + TLS
   ↓
our HTTP/1.1 parser
   ↓
HTML tokenizer/parser
   ↓
compact DOM arena
   ↓
visible-text traversal
   ↓
native pixel renderer
```

## Memory-oriented DOM design

The DOM deliberately avoids a tree made from `Rc<RefCell<Node>>` or one heap allocation per node.

Instead it uses:

- one contiguous `Vec<Node>` arena
- 32-bit `NodeId` values
- compact parent / first-child / last-child / next-sibling links
- boxed strings only for actual tag, attribute, and text contents
- iterative visible-text traversal instead of recursive tree walking

This gives us a clean future path for dropping an entire inactive tab DOM at once.

## Parser features in 0.2

- nested element nodes
- text nodes
- parent/child/sibling relationships
- quoted and unquoted attributes
- HTML comments
- void elements such as `br`, `img`, `meta`, and `input`
- raw `script` and `style` contents
- common named entities
- decimal and hexadecimal numeric entities
- basic malformed closing-tag recovery

## Security / memory limits

- HTTPS only
- certificate verification enabled
- 2 MiB HTTP response limit
- 10-second socket read/write timeout
- maximum 100,000 DOM nodes
- maximum DOM depth of 1,024
- maximum 256 attributes per element
- no JavaScript execution
- no cookies
- no extension system
- no page access to files, camera, microphone, location, USB, Bluetooth, or clipboard

## Run on Windows

```powershell
cd browser-engine
cargo run --release -- https://example.com
```

Press **Esc** to close.

## What is intentionally still missing

This is not yet a standards-complete HTML5 parser. In particular, HTML5 error-recovery rules, implicit element insertion, CSS layout, images, navigation, forms, JavaScript, and persistent storage are not implemented.

The next milestone is a small CSS parser and style system that attaches computed style data to DOM nodes.
