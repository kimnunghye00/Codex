mod browser;
mod history;
mod ipc;
mod net;
mod render;
mod renderer_process;
mod resource_limits;
mod sandbox;

use std::error::Error;

const DEFAULT_URL: &str = "https://example.com";

fn main() -> Result<(), Box<dyn Error>> {
    let _ = rustls::crypto::ring::default_provider().install_default();

    let target = std::env::args()
        .nth(1)
        .unwrap_or_else(|| DEFAULT_URL.to_string());

    browser::run(&target)
}
