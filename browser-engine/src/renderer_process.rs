use crate::ipc::{self, ImageBlob, RenderPacket, ResourceBundle, ScanResponse};
use crate::{navigation::Control, net, resource_limits, sandbox};
use std::error::Error;
use std::path::PathBuf;

pub fn render_page(
    base_url: &str,
    html: &[u8],
    viewport_width: u32,
) -> Result<RenderPacket, Box<dyn Error>> {
    render_page_controlled(base_url, html, viewport_width, None)
}

pub fn render_page_controlled(
    base_url: &str,
    html: &[u8],
    viewport_width: u32,
    control: Option<&Control>,
) -> Result<RenderPacket, Box<dyn Error>> {
    render_page_session(base_url, html, viewport_width, control, None)
}

pub fn render_page_session(
    base_url: &str,
    html: &[u8],
    viewport_width: u32,
    control: Option<&Control>,
    session: Option<&mut net::Session>,
) -> Result<RenderPacket, Box<dyn Error>> {
    if let Some(control) = control {
        control.check()?;
    }
    let renderer = renderer_executable()?;
    let mut child = sandbox::spawn_renderer(&renderer)?;
    child.start_watchdog(control.cloned())?;

    let mut stdin = match child.take_stdin() {
        Ok(stdin) => stdin,
        Err(error) => {
            child.kill();
            return Err(error.into());
        }
    };

    let mut stdout = match child.take_stdout() {
        Ok(stdout) => stdout,
        Err(error) => {
            child.kill();
            return Err(error.into());
        }
    };

    if let Err(error) = ipc::read_ready(&mut stdout) {
        drop(stdin);
        let process_result = child.wait_success();
        return Err(format!(
            "renderer failed before READY: {error}; process result: {process_result:?}"
        )
        .into());
    }

    if let Err(error) = child.activate_content_restrictions() {
        child.kill();
        return Err(format!("renderer content sandbox activation failed: {error}").into());
    }

    // The worker has only completed trusted runtime initialization at READY.
    // No document bytes are sent before Restricted Token + Low Integrity +
    // Job resource limits + Job UI restrictions are all active.
    if let Err(error) = ipc::write_load_document(&mut stdin, base_url, viewport_width, html) {
        child.kill();
        return Err(error.into());
    }

    let scan = match ipc::read_scan(&mut stdout) {
        Ok(scan) => scan,
        Err(error) => {
            drop(stdin);
            let process_result = child.wait_success();
            return Err(format!(
                "renderer failed before SCAN: {error}; process result: {process_result:?}"
            )
            .into());
        }
    };

    let resources = fetch_resources(base_url, &scan, control, session)?;
    if let Err(error) = ipc::write_resources(&mut stdin, &resources) {
        child.kill();
        return Err(error.into());
    }

    let packet = match ipc::read_render(&mut stdout) {
        Ok(packet) => packet,
        Err(error) => {
            drop(stdin);
            let process_result = child.wait_success();
            return Err(format!(
                "renderer failed before RNDR: {error}; process result: {process_result:?}"
            )
            .into());
        }
    };

    drop(stdin);
    child.wait_success()?;

    Ok(packet)
}

fn renderer_executable() -> Result<PathBuf, Box<dyn Error>> {
    let current = std::env::current_exe()?;
    let directory = current
        .parent()
        .ok_or("browser executable does not have a parent directory")?;

    let filename = format!("browser-renderer{}", std::env::consts::EXE_SUFFIX);
    let candidate = directory.join(filename);

    if !candidate.is_file() {
        return Err(format!(
            "renderer executable was not found at {}. Build both binaries with cargo build --bins.",
            candidate.display()
        )
        .into());
    }

    Ok(candidate)
}

fn fetch_resources(
    base_url: &str,
    scan: &ScanResponse,
    control: Option<&Control>,
    mut session: Option<&mut net::Session>,
) -> Result<ResourceBundle, Box<dyn Error>> {
    let mut css = Vec::with_capacity(scan.css_sources.len());
    let mut total_css = 0usize;

    for source in scan
        .css_sources
        .iter()
        .take(resource_limits::MAX_EXTERNAL_STYLESHEETS)
    {
        if let Some(control) = control {
            control.check()?;
        }
        let remaining = resource_limits::MAX_TOTAL_EXTERNAL_CSS_BYTES.saturating_sub(total_css);
        let limit = remaining.min(resource_limits::MAX_EXTERNAL_CSS_BYTES);

        if limit == 0 {
            css.push(Vec::new());
            continue;
        }

        let bytes = match net::resolve_https_url(base_url, source).and_then(|url| {
            fetch_resource(
                &mut session,
                &url,
                limit,
                "text/css,*/*;q=0.1",
                base_url,
                control,
            )
        }) {
            Ok(response) if (200..300).contains(&response.status) => response.body,
            Ok(_) => Vec::new(),
            Err(error) => {
                eprintln!("[browser-core] stylesheet blocked/failed: {error}");
                Vec::new()
            }
        };

        total_css = total_css.saturating_add(bytes.len());
        css.push(bytes);
    }

    let mut images = Vec::with_capacity(scan.images.len());
    let mut total_images = 0usize;

    for image in scan.images.iter().take(resource_limits::MAX_IMAGES) {
        if let Some(control) = control {
            control.check()?;
        }
        let remaining = resource_limits::MAX_TOTAL_ENCODED_IMAGE_BYTES.saturating_sub(total_images);
        let limit = remaining.min(resource_limits::MAX_ENCODED_IMAGE_BYTES);

        if limit == 0 {
            images.push(ImageBlob {
                node: image.node,
                bytes: Vec::new(),
            });
            continue;
        }

        let bytes = match net::resolve_https_url(base_url, &image.source).and_then(|url| {
            fetch_resource(
                &mut session,
                &url,
                limit,
                "image/png,image/jpeg;q=0.9,*/*;q=0.1",
                base_url,
                control,
            )
        }) {
            Ok(response) if (200..300).contains(&response.status) => response.body,
            Ok(_) => Vec::new(),
            Err(error) => {
                eprintln!("[browser-core] image blocked/failed: {error}");
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

pub fn watchdog_self_test() -> Result<(), Box<dyn Error>> {
    use std::sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    };
    let generation = Arc::new(AtomicU64::new(1));
    let control = Control::new(generation.clone(), 1);
    let mut child = sandbox::spawn_renderer(&renderer_executable()?)?;
    let _stdin = child.take_stdin()?;
    let mut stdout = child.take_stdout()?;
    child.start_watchdog(Some(control))?;
    ipc::read_ready(&mut stdout)?;
    child.activate_content_restrictions()?;
    let start = std::time::Instant::now();
    generation.store(2, Ordering::Relaxed);
    if ipc::read_scan(&mut stdout).is_ok() {
        return Err("cancelled renderer returned SCAN unexpectedly".into());
    }
    if child.wait_success().is_ok() {
        return Err("cancelled renderer exited successfully instead of being terminated".into());
    }
    if start.elapsed() > std::time::Duration::from_secs(3) {
        return Err("renderer cancellation was too slow".into());
    }
    println!("renderer watchdog self-test ok");
    Ok(())
}

fn fetch_resource(
    session: &mut Option<&mut net::Session>,
    url: &str,
    limit: usize,
    accept: &str,
    base: &str,
    control: Option<&Control>,
) -> Result<net::HttpResponse, Box<dyn Error>> {
    if let Some(session) = session.as_deref_mut() {
        session.resource(url, limit, accept, base, control)
    } else {
        net::fetch_controlled(url, limit, accept, control)
    }
}
