mod browser;
mod clipboard;
mod font;
mod history;
mod ipc;
mod navigation;
mod net;
mod profile;
mod render;
mod renderer_process;
mod resource_limits;
mod sandbox;
mod tabs;
mod text_input;
mod text_metrics;

use std::error::Error;

const DEFAULT_URL: &str = "browser:home";

fn main() -> Result<(), Box<dyn Error>> {
    let _ = rustls::crypto::ring::default_provider().install_default();

    let first = std::env::args().nth(1);

    if first.as_deref() == Some("--sandbox-self-test") {
        let packet = renderer_process::render_page(
            "https://example.com/",
            "<body><p>sandbox-ok 한글</p><script>must-not-paint</script></body>".as_bytes(),
            320,
        )?;

        let rendered_marker = packet
            .texts
            .iter()
            .any(|fragment| fragment.text.contains("sandbox-ok"));

        let korean = packet
            .texts
            .iter()
            .any(|fragment| fragment.text.contains("한글"));
        let hidden = packet
            .texts
            .iter()
            .any(|fragment| fragment.text.contains("must-not-paint"));
        if !rendered_marker || !korean || hidden {
            return Err("sandbox renderer self-test did not return the expected paint text".into());
        }

        println!("sandbox self-test ok");
        return Ok(());
    }

    if first.as_deref() == Some("--watchdog-self-test") {
        return renderer_process::watchdog_self_test();
    }

    if first.as_deref() == Some("--render-file") {
        let source = std::env::args()
            .nth(2)
            .ok_or("--render-file requires an HTML file")?;
        let output = std::env::args()
            .nth(3)
            .ok_or("--render-file requires a PPM output file")?;
        use std::io::{Read, Write};
        let mut bytes = Vec::new();
        std::fs::File::open(source)?
            .take(2 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err("fixture is too large".into());
        }
        let packet =
            renderer_process::render_page("https://example.com/", &bytes, render::PAGE_WIDTH)?;
        let pixels = render::paint(
            "https://example.com/",
            "",
            false,
            None,
            0,
            &packet,
            false,
            false,
        );
        let mut file = std::io::BufWriter::new(std::fs::File::create(output)?);
        writeln!(file, "P6\n{} {}\n255", render::WIDTH, render::HEIGHT)?;
        for pixel in pixels {
            file.write_all(&[(pixel >> 16) as u8, (pixel >> 8) as u8, pixel as u8])?;
        }
        println!(
            "Rendered {} text fragments, {} images, {}px height",
            packet.texts.len(),
            packet.images.len(),
            packet.content_height
        );
        return Ok(());
    }

    let target = first.unwrap_or_else(|| DEFAULT_URL.to_string());
    browser::run(&target)
}
