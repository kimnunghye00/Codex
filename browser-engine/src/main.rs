mod browser;
mod css;
mod dom;
mod history;
mod html;
mod ipc;
mod layout;
mod net;
mod render;
mod renderer_process;
mod renderer_worker;
mod resources;
mod sandbox;
mod style;

use std::error::Error;

const DEFAULT_URL: &str = "https://example.com";

fn main() -> Result<(), Box<dyn Error>> {
    if std::env::args().nth(1).as_deref() == Some("--renderer-worker") {
        return renderer_worker::run();
    }

    let _ = rustls::crypto::ring::default_provider().install_default();

    let target = std::env::args()
        .nth(1)
        .unwrap_or_else(|| DEFAULT_URL.to_string());

    browser::run(&target)
}
