mod browser;
mod css;
mod dom;
mod history;
mod html;
mod layout;
mod net;
mod render;
mod resources;
mod style;

use std::error::Error;

const DEFAULT_URL: &str = "https://example.com";

fn main() -> Result<(), Box<dyn Error>> {
    // TLS is delegated to rustls. Browser parsing, resource policy, layout,
    // navigation, scrolling, and rendering remain inside browser-core.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let target = std::env::args()
        .nth(1)
        .unwrap_or_else(|| DEFAULT_URL.to_string());

    browser::run(&target)
}
