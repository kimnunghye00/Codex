mod dom;
mod html;
mod net;
mod render;

use std::error::Error;

const DEFAULT_URL: &str = "https://example.com";

fn main() -> Result<(), Box<dyn Error>> {
    // Cryptography is intentionally delegated to a maintained TLS library.
    // HTTP, HTML parsing, DOM construction, text layout, and rendering are ours.
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

    let source = String::from_utf8_lossy(&response.body);
    let document = html::parse(&source)?;
    println!("[browser-core] DOM contains {} nodes", document.len());

    let text = document.visible_text();
    render::show(&target, &text)?;

    Ok(())
}
