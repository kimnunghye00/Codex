mod html;
mod net;
mod render;

use std::error::Error;

const DEFAULT_URL: &str = "https://example.com";

fn main() -> Result<(), Box<dyn Error>> {
    // We deliberately use a maintained TLS implementation instead of inventing
    // cryptography. The browser/network/HTML/rendering logic remains ours.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let target = std::env::args()
        .nth(1)
        .unwrap_or_else(|| DEFAULT_URL.to_string());

    println!("[browser-core] GET {target}");

    let response = net::fetch_https(&target)?;
    println!(
        "[browser-core] HTTP {} | received {} bytes",
        response.status,
        response.body.len()
    );

    let html = String::from_utf8_lossy(&response.body);
    let text = html::html_to_text(&html);

    render::show(&target, &text)?;
    Ok(())
}
