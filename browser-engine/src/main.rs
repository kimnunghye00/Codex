mod browser;
mod clipboard;
mod cookies;
mod font;
mod forms;
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

    if first.as_deref() == Some("--forms-self-test") {
        let mut packet = renderer_process::render_page(
            "https://example.com/",
            include_bytes!("../tests/fixtures/forms.html"),
            render::PAGE_WIDTH,
        )?;
        let field = packet
            .controls
            .iter()
            .position(|c| c.name == "q")
            .ok_or("search field missing")?;
        if !forms::append(&mut packet.controls[field], "한글 & test", true) {
            return Err("form editing failed".into());
        }
        let submit = packet
            .controls
            .iter()
            .position(|c| c.name == "go")
            .ok_or("submit missing")?;
        let result = forms::submit(
            "https://example.com/",
            &packet.controls,
            field,
            Some(submit),
        )?;
        let url = url::Url::parse(&result.url)?;
        if !url
            .query_pairs()
            .any(|(name, value)| name == "q" && value == "한글 & test")
        {
            return Err("form encoding failed".into());
        }
        let password = packet
            .controls
            .iter()
            .position(|c| c.name == "password")
            .ok_or("password missing")?;
        let result = forms::submit("https://example.com/", &packet.controls, password, None)?;
        if result.body.is_none() || result.url.contains("fixture-secret") {
            return Err("password leaked into URL".into());
        }
        println!("form IPC, input, GET and POST self-test ok");
        return Ok(());
    }

    if first.as_deref() == Some("--watchdog-self-test") {
        return renderer_process::watchdog_self_test();
    }

    if matches!(first.as_deref(), Some("--render-file" | "--render-url")) {
        let remote = first.as_deref() == Some("--render-url");
        let source = std::env::args().nth(2).ok_or("render requires a source")?;
        let output = std::env::args()
            .nth(3)
            .ok_or("render requires a PPM output file")?;
        use std::io::{Read, Write};
        let control =
            navigation::Control::new(std::sync::Arc::new(std::sync::atomic::AtomicU64::new(1)), 1);
        let (base_url, bytes) = if remote {
            let response = net::fetch_document(&source, &control)?;
            if !(200..300).contains(&response.status) {
                return Err(format!("HTTP status {}", response.status).into());
            }
            if let Some(mime) = response.content_type.as_deref() {
                if !matches!(
                    mime.split(';').next().unwrap_or("").trim(),
                    "text/html" | "application/xhtml+xml"
                ) {
                    return Err("Unsupported document type".into());
                }
            }
            println!("HTTPS document received: {} bytes", response.body.len());
            (response.final_url, response.body)
        } else {
            let mut bytes = Vec::new();
            std::fs::File::open(source)?
                .take(2 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)?;
            if bytes.len() > 2 * 1024 * 1024 {
                return Err("fixture is too large".into());
            }
            ("https://example.com/".to_string(), bytes)
        };
        let packet = renderer_process::render_page_controlled(
            &base_url,
            &bytes,
            render::PAGE_WIDTH,
            Some(&control),
        )?;
        let pixels = render::paint(&base_url, "", false, None, 0, &packet, false, false);
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
        if remote && packet.texts.is_empty() {
            return Err("remote document returned no paint text".into());
        }
        return Ok(());
    }

    let target = first.unwrap_or_else(|| DEFAULT_URL.to_string());
    browser::run(&target)
}
