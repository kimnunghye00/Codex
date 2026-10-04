# browser-core 0.6

A browser-engine prototype built without Chromium, WebView2, or Firefox.

## Milestone 0.6: address bar, scrolling, external resources

Version 0.6 adds practical browsing controls while keeping hard resource ceilings.

### New user-visible features

- editable address bar
- click the address bar or press Ctrl+L
- bare domains such as example.com are normalized to HTTPS
- Enter navigates
- mouse-wheel scrolling
- Up / Down, PageUp / PageDown, Home / End scrolling
- external link rel="stylesheet" stylesheets
- PNG and JPEG img resources
- image layout and painting
- linked images participate in hit testing

### HTTPS-only navigation remains enforced

The address bar, links, redirects, external CSS, and image resources all use the same HTTPS-only URL policy.

Blocked schemes include HTTP, javascript, data, file, and any other non-HTTPS scheme. URLs containing embedded usernames or passwords are also rejected.

## Resource budgets

External CSS:

- at most 8 external stylesheets per page
- 128 KiB per stylesheet
- 512 KiB total external CSS
- combined CSS rule cap remains enforced

Images:

- PNG and JPEG only
- at most 12 decoded images per page
- 1 MiB encoded size per image
- 6 MiB total encoded image budget
- maximum dimension: 2048 px
- maximum 2,000,000 pixels per image
- maximum 12 MiB decoded image-pixel budget per page

Image dimensions are inspected before full decoding. Decoder panics are contained so malformed image input does not terminate the whole browser process in this prototype.

## Memory design

Only the current page retains its DOM, computed styles, Layout Tree, decoded images, and external CSS.

Back/forward history still retains URLs only, so old page resources are dropped on navigation.

The renderer only paints the visible scroll viewport even though layout coordinates cover the full document.

## Controls

- Ctrl+L: focus/select address
- Enter: navigate
- Esc: leave address editing; Esc again closes
- Alt+Left / Alt+Right: back / forward
- F5: reload
- mouse wheel: scroll
- PageUp / PageDown
- Home / End
- Up / Down

## Still intentionally missing

- JavaScript
- forms/input controls inside web pages
- cookies
- persistent storage
- web fonts
- SVG
- GIF/WebP image decoding
- CSS imports
- complex CSS selectors
- flexbox/grid
- decoder process isolation

The next security-focused milestone should split risky content handling away from the privileged browser UI, beginning with a renderer/resource sandbox and a narrow IPC boundary.
