# browser-core 0.8

A browser-engine prototype built without Chromium, WebView2, or Firefox.

## Milestone 0.8: restricted renderer identity

Version 0.8 strengthens the process boundary introduced in 0.7.

### Separate executable

The project now builds two executables:

- browser-core: privileged UI, HTTPS broker, history, and final painting
- browser-renderer: HTML/DOM/CSS/image decoding/style/layout and IPC only

The renderer binary does not include browser networking or window/navigation modules. External CSS and image bytes are still fetched by the broker after HTTPS policy checks and sent through bounded IPC.

Build both with:

    cargo build --bins

The executables must remain beside each other.

### Windows restricted launch

On Windows the broker no longer launches the renderer with a normal inherited user token.

The broker now:

1. opens its own process token
2. creates a restricted token with maximum privileges disabled
3. adds a restricting SID for write access
4. changes the token mandatory integrity level to Low
5. creates browser-renderer suspended with CreateProcessAsUserW
6. applies the existing Job Object limits and UI restrictions
7. only then resumes the renderer thread
8. sends untrusted HTML after the security boundary is active

The launch fails closed if token restriction, Low Integrity, Job Object setup, or process assignment fails.

### Existing Job Object limits

- one renderer process
- 192 MiB process memory limit
- 10 seconds user-mode CPU time
- renderer terminated when the Job Object closes
- unhandled-exception termination behavior
- clipboard read/write blocked
- cross-process USER handle access restricted
- display/system parameter changes blocked
- global atoms restricted
- desktop creation/switching restricted
- ExitWindows blocked

### IPC remains narrow

The protocol still permits only:

- LOAD: document bytes and viewport
- SCAN: bounded CSS/image references
- RSRC: broker-approved resource bytes
- RNDR: bounded flat paint output

The renderer cannot ask the broker to execute arbitrary commands.

### Memory behavior

The renderer is ephemeral. DOM, parsed CSS, layout tree, encoded resources, and temporary decode state disappear when the renderer exits.

The main browser retains only current flat paint data, current decoded image pixels, URL state, and its framebuffer.

### Important remaining limit

Restricted Token + Low Integrity + Job Object is materially stronger than 0.7, but it is still not AppContainer.

The separate renderer binary contains no direct networking code, so normal renderer operation can only obtain web resources through broker IPC. However, Windows is not yet enforcing a kernel-level no-network capability on the renderer token itself.

Likewise, Low Integrity strongly limits writes to normal user objects, but it is not a complete deny-all filesystem policy for reads.

The next security milestone should use an AppContainer-capable launch path or the newer Windows sandbox process APIs where available, with OS-enforced network denial and explicit filesystem allowlists.
