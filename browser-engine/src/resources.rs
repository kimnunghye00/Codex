use crate::css::{self, Stylesheet};
use crate::dom::{Document, NodeId, NodeKind};
use crate::net;
use image::ImageReader;
use std::error::Error;
use std::io::Cursor;
use std::panic::{catch_unwind, AssertUnwindSafe};

const MAX_EXTERNAL_STYLESHEETS: usize = 8;
const MAX_EXTERNAL_CSS_BYTES: usize = 128 * 1024;
const MAX_TOTAL_EXTERNAL_CSS_BYTES: usize = 512 * 1024;

const MAX_IMAGES: usize = 12;
const MAX_ENCODED_IMAGE_BYTES: usize = 1024 * 1024;
const MAX_TOTAL_ENCODED_IMAGE_BYTES: usize = 6 * 1024 * 1024;
const MAX_IMAGE_DIMENSION: u32 = 2048;
const MAX_IMAGE_PIXELS: u64 = 2_000_000;
const MAX_TOTAL_DECODED_IMAGE_BYTES: u64 = 12 * 1024 * 1024;

#[derive(Debug)]
pub struct ImageResource {
    pub node: NodeId,
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u32>,
}

#[derive(Debug, Default)]
pub struct ResourceSet {
    images: Vec<ImageResource>,
}

impl ResourceSet {
    pub fn image(&self, node: NodeId) -> Option<&ImageResource> {
        self.images.iter().find(|image| image.node == node)
    }

    pub fn image_dimensions(&self, node: NodeId) -> Option<(u32, u32)> {
        self.image(node).map(|image| (image.width, image.height))
    }

    pub fn image_count(&self) -> usize {
        self.images.len()
    }
}

pub fn load_stylesheets(
    document: &Document,
    base_url: &str,
) -> Result<Stylesheet, Box<dyn Error>> {
    let mut stylesheet = Stylesheet::from_document(document)?;
    let mut loaded = 0usize;
    let mut total_bytes = 0usize;

    for index in 0..document.len() {
        if loaded >= MAX_EXTERNAL_STYLESHEETS || total_bytes >= MAX_TOTAL_EXTERNAL_CSS_BYTES {
            break;
        }

        let id = index as NodeId;
        let Some(node) = document.node(id) else {
            continue;
        };
        let NodeKind::Element(element) = node.kind() else {
            continue;
        };

        if element.tag_name() != "link" {
            continue;
        }

        let is_stylesheet = element
            .attribute("rel")
            .map(|rel| {
                rel.split_ascii_whitespace()
                    .any(|token| token.eq_ignore_ascii_case("stylesheet"))
            })
            .unwrap_or(false);
        if !is_stylesheet {
            continue;
        }

        let Some(href) = element.attribute("href") else {
            continue;
        };
        let Ok(url) = net::resolve_https_url(base_url, href) else {
            continue;
        };

        let remaining = MAX_TOTAL_EXTERNAL_CSS_BYTES.saturating_sub(total_bytes);
        let limit = remaining.min(MAX_EXTERNAL_CSS_BYTES);
        if limit == 0 {
            break;
        }

        let response = match net::fetch_resource_https(&url, limit, "text/css,*/*;q=0.1") {
            Ok(response) => response,
            Err(error) => {
                eprintln!("[browser-core] stylesheet blocked/failed {url}: {error}");
                continue;
            }
        };

        if !(200..300).contains(&response.status) {
            continue;
        }

        total_bytes = total_bytes.saturating_add(response.body.len());
        let source = String::from_utf8_lossy(&response.body);

        match css::parse_stylesheet(&source) {
            Ok(other) => {
                stylesheet.append(other)?;
                loaded += 1;
            }
            Err(error) => {
                eprintln!("[browser-core] stylesheet parse failed {url}: {error}");
            }
        }
    }

    Ok(stylesheet)
}

pub fn load_images(document: &Document, base_url: &str) -> ResourceSet {
    let mut resources = ResourceSet::default();
    let mut total_encoded = 0usize;
    let mut total_decoded = 0u64;

    for index in 0..document.len() {
        if resources.images.len() >= MAX_IMAGES
            || total_encoded >= MAX_TOTAL_ENCODED_IMAGE_BYTES
            || total_decoded >= MAX_TOTAL_DECODED_IMAGE_BYTES
        {
            break;
        }

        let id = index as NodeId;
        let Some(node) = document.node(id) else {
            continue;
        };
        let NodeKind::Element(element) = node.kind() else {
            continue;
        };

        if element.tag_name() != "img" {
            continue;
        }

        let Some(src) = element.attribute("src") else {
            continue;
        };
        let Ok(url) = net::resolve_https_url(base_url, src) else {
            continue;
        };

        let encoded_remaining = MAX_TOTAL_ENCODED_IMAGE_BYTES.saturating_sub(total_encoded);
        let limit = encoded_remaining.min(MAX_ENCODED_IMAGE_BYTES);
        if limit == 0 {
            break;
        }

        let response = match net::fetch_resource_https(
            &url,
            limit,
            "image/png,image/jpeg;q=0.9,*/*;q=0.1",
        ) {
            Ok(response) => response,
            Err(error) => {
                eprintln!("[browser-core] image blocked/failed {url}: {error}");
                continue;
            }
        };

        if !(200..300).contains(&response.status) || response.body.is_empty() {
            continue;
        }

        total_encoded = total_encoded.saturating_add(response.body.len());

        match decode_image_safely(id, &response.body, total_decoded) {
            Ok(Some(image)) => {
                total_decoded = total_decoded
                    .saturating_add(image.width as u64 * image.height as u64 * 4);
                resources.images.push(image);
            }
            Ok(None) => {}
            Err(error) => {
                eprintln!("[browser-core] image decode rejected {url}: {error}");
            }
        }
    }

    resources
}

fn decode_image_safely(
    node: NodeId,
    encoded: &[u8],
    decoded_so_far: u64,
) -> Result<Option<ImageResource>, Box<dyn Error>> {
    let dimensions = catch_unwind(AssertUnwindSafe(|| {
        ImageReader::new(Cursor::new(encoded))
            .with_guessed_format()?
            .into_dimensions()
    }))
    .map_err(|_| "image header decoder panicked")??;

    let (width, height) = dimensions;
    let pixels = width as u64 * height as u64;
    let decoded_bytes = pixels.saturating_mul(4);

    if width == 0
        || height == 0
        || width > MAX_IMAGE_DIMENSION
        || height > MAX_IMAGE_DIMENSION
        || pixels > MAX_IMAGE_PIXELS
        || decoded_so_far.saturating_add(decoded_bytes) > MAX_TOTAL_DECODED_IMAGE_BYTES
    {
        return Ok(None);
    }

    let decoded = catch_unwind(AssertUnwindSafe(|| image::load_from_memory(encoded)))
        .map_err(|_| "image decoder panicked")??;
    let rgba = decoded.to_rgba8();

    if rgba.width() != width || rgba.height() != height {
        return Err("image dimensions changed during decode".into());
    }

    let raw = rgba.into_raw();
    if raw.len() as u64 != decoded_bytes {
        return Err("decoded image buffer has an unexpected size".into());
    }

    let mut packed = Vec::with_capacity(pixels as usize);
    for rgba in raw.chunks_exact(4) {
        packed.push(
            ((rgba[3] as u32) << 24)
                | ((rgba[0] as u32) << 16)
                | ((rgba[1] as u32) << 8)
                | rgba[2] as u32,
        );
    }

    Ok(Some(ImageResource {
        node,
        width,
        height,
        pixels: packed,
    }))
}
