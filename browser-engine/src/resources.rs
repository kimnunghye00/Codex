use crate::css::{self, Stylesheet};
use crate::dom::{Document, NodeId, NodeKind};
use crate::ipc::{ImageBlob, ImageRequest, ScanResponse};
use image::ImageReader;
use std::error::Error;
use std::io::Cursor;
use std::panic::{catch_unwind, AssertUnwindSafe};

pub const MAX_EXTERNAL_STYLESHEETS: usize = 8;
pub const MAX_EXTERNAL_CSS_BYTES: usize = 128 * 1024;
pub const MAX_TOTAL_EXTERNAL_CSS_BYTES: usize = 512 * 1024;

pub const MAX_IMAGES: usize = 12;
pub const MAX_ENCODED_IMAGE_BYTES: usize = 1024 * 1024;
pub const MAX_TOTAL_ENCODED_IMAGE_BYTES: usize = 6 * 1024 * 1024;
const MAX_REFERENCE_BYTES: usize = 8 * 1024;
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
}

pub fn scan_requests(document: &Document) -> ScanResponse {
    let mut response = ScanResponse::default();

    for index in 0..document.len() {
        let id = index as NodeId;
        let Some(node) = document.node(id) else {
            continue;
        };
        let NodeKind::Element(element) = node.kind() else {
            continue;
        };

        if element.tag_name() == "link"
            && response.css_sources.len() < MAX_EXTERNAL_STYLESHEETS
        {
            let is_stylesheet = element
                .attribute("rel")
                .map(|rel| {
                    rel.split_ascii_whitespace()
                        .any(|token| token.eq_ignore_ascii_case("stylesheet"))
                })
                .unwrap_or(false);

            if is_stylesheet {
                if let Some(href) = element.attribute("href") {
                    if !href.is_empty() && href.len() <= MAX_REFERENCE_BYTES {
                        response.css_sources.push(href.to_string());
                    }
                }
            }
        }

        if element.tag_name() == "img" && response.images.len() < MAX_IMAGES {
            if let Some(src) = element.attribute("src") {
                if !src.is_empty() && src.len() <= MAX_REFERENCE_BYTES {
                    response.images.push(ImageRequest {
                        node: id,
                        source: src.to_string(),
                    });
                }
            }
        }

        if response.css_sources.len() >= MAX_EXTERNAL_STYLESHEETS
            && response.images.len() >= MAX_IMAGES
        {
            break;
        }
    }

    response
}

pub fn build_stylesheet(
    document: &Document,
    external_css: &[Vec<u8>],
) -> Result<Stylesheet, Box<dyn Error>> {
    let mut stylesheet = Stylesheet::from_document(document)?;
    let mut total = 0usize;

    for bytes in external_css.iter().take(MAX_EXTERNAL_STYLESHEETS) {
        if bytes.is_empty() {
            continue;
        }

        total = total.saturating_add(bytes.len());
        if bytes.len() > MAX_EXTERNAL_CSS_BYTES || total > MAX_TOTAL_EXTERNAL_CSS_BYTES {
            return Err("external CSS exceeded the renderer resource budget".into());
        }

        let source = String::from_utf8_lossy(bytes);
        stylesheet.append(css::parse_stylesheet(&source)?)?;
    }

    Ok(stylesheet)
}

pub fn decode_images(blobs: &[ImageBlob]) -> ResourceSet {
    let mut resources = ResourceSet::default();
    let mut total_encoded = 0usize;
    let mut total_decoded = 0u64;

    for blob in blobs.iter().take(MAX_IMAGES) {
        if blob.bytes.is_empty() {
            continue;
        }

        total_encoded = total_encoded.saturating_add(blob.bytes.len());
        if blob.bytes.len() > MAX_ENCODED_IMAGE_BYTES
            || total_encoded > MAX_TOTAL_ENCODED_IMAGE_BYTES
        {
            break;
        }

        match decode_image_safely(blob.node, &blob.bytes, total_decoded) {
            Ok(Some(image)) => {
                total_decoded = total_decoded
                    .saturating_add(image.width as u64 * image.height as u64 * 4);
                resources.images.push(image);
            }
            Ok(None) => {}
            Err(error) => {
                eprintln!("[renderer-worker] image rejected: {error}");
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
