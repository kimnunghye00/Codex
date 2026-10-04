mod browser;
mod css;
mod dom;
mod history;
mod html;
mod layout;
mod net;
mod render;
mod style;

use std::error::Error;

const DEFAULT_URL: &str = "https://example.com";

fn main() -> Result<(), Box<dyn Error>> {
    // Cryptography is intentionally delegated to a maintained TLS library.
    // HTTP, HTML, DOM, CSS, style, layout, navigation, history, and rendering are ours.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let target = std::env::args()
        .nth(1)
        .unwrap_or_else(|| DEFAULT_URL.to_string());

    browser::run(&target)
}
