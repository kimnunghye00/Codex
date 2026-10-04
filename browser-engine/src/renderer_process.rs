use crate::ipc::{
    self, ImageBlob, LoadRequest, RenderPacket, ResourceBundle, ScanResponse,
};
use crate::{net, resources, sandbox};
use std::error::Error;
use std::process::{Command, Stdio};

pub fn render_page(
    base_url: &str,
    html: &[u8],
    viewport_width: u32,
) -> Result<RenderPacket, Box<dyn Error>> {
    let executable = std::env::current_exe()?;

    let mut child = Command::new(executable)
        .arg("--renderer-worker")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()?;

    // The worker starts by blocking on stdin. Apply OS limits before any
    // untrusted document bytes are sent to it.
    let _sandbox = match sandbox::confine_renderer(&child) {
        Ok(sandbox) => sandbox,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("renderer sandbox setup failed: {error}").into());
        }
    };

    let mut stdin = child
        .stdin
        .take()
        .ok_or("renderer worker stdin was not available")?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or("renderer worker stdout was not available")?;

    ipc::write_load(
        &mut stdin,
        &LoadRequest {
            base_url: base_url.to_string(),
            viewport_width,
            html: html.to_vec(),
        },
    )?;

    let scan = ipc::read_scan(&mut stdout)?;
    let resources = fetch_resources(base_url, &scan)?;
    ipc::write_resources(&mut stdin, &resources)?;

    let packet = ipc::read_render(&mut stdout)?;
    drop(stdin);

    let status = child.wait()?;
    if !status.success() {
        return Err(format!("renderer worker exited with {status}").into());
    }

    Ok(packet)
}

fn fetch_resources(
    base_url: &str,
    scan: &ScanResponse,
) -> Result<ResourceBundle, Box<dyn Error>> {
    let mut css = Vec::with_capacity(scan.css_sources.len());
    let mut total_css = 0usize;

    for source in scan
        .css_sources
        .iter()
        .take(resources::MAX_EXTERNAL_STYLESHEETS)
    {
        let remaining = resources::MAX_TOTAL_EXTERNAL_CSS_BYTES.saturating_sub(total_css);
        let limit = remaining.min(resources::MAX_EXTERNAL_CSS_BYTES);

        if limit == 0 {
            css.push(Vec::new());
            continue;
        }

        let bytes = match net::resolve_https_url(base_url, source)
            .and_then(|url| net::fetch_resource_https(&url, limit, "text/css,*/*;q=0.1"))
        {
            Ok(response) if (200..300).contains(&response.status) => response.body,
            Ok(_) => Vec::new(),
            Err(error) => {
                eprintln!("[browser-core] stylesheet blocked/failed {source:?}: {error}");
                Vec::new()
            }
        };

        total_css = total_css.saturating_add(bytes.len());
        css.push(bytes);
    }

    let mut images = Vec::with_capacity(scan.images.len());
    let mut total_images = 0usize;

    for image in scan.images.iter().take(resources::MAX_IMAGES) {
        let remaining = resources::MAX_TOTAL_ENCODED_IMAGE_BYTES.saturating_sub(total_images);
        let limit = remaining.min(resources::MAX_ENCODED_IMAGE_BYTES);

        if limit == 0 {
            images.push(ImageBlob {
                node: image.node,
                bytes: Vec::new(),
            });
            continue;
        }

        let bytes = match net::resolve_https_url(base_url, &image.source).and_then(|url| {
            net::fetch_resource_https(
                &url,
                limit,
                "image/png,image/jpeg;q=0.9,*/*;q=0.1",
            )
        }) {
            Ok(response) if (200..300).contains(&response.status) => response.body,
            Ok(_) => Vec::new(),
            Err(error) => {
                eprintln!(
                    "[browser-core] image blocked/failed {:?}: {error}",
                    image.source
                );
                Vec::new()
            }
        };

        total_images = total_images.saturating_add(bytes.len());
        images.push(ImageBlob {
            node: image.node,
            bytes,
        });
    }

    Ok(ResourceBundle { css, images })
}
