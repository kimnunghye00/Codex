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

    let first = std::env::args().nth(1);

    if first.as_deref() == Some("--sandbox-self-test") {
        let packet = renderer_process::render_page(
            "https://example.com/",
            b"<body><p>sandbox-ok</p></body>",
            320,
        )?;

        let rendered_marker = packet
            .texts
            .iter()
            .any(|fragment| fragment.text.contains("sandbox-ok"));

        if !rendered_marker {
            return Err("sandbox renderer self-test did not return the expected paint text".into());
        }

        println!("sandbox self-test ok");
        return Ok(());
    }

    let target = first.unwrap_or_else(|| DEFAULT_URL.to_string());
    browser::run(&target)
}
