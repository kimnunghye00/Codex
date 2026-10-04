use crate::dom::NodeId;
use std::io::{self, Read, Write};

const TAG_LOAD: &[u8; 4] = b"LOAD";
const TAG_SCAN: &[u8; 4] = b"SCAN";
const TAG_RESOURCES: &[u8; 4] = b"RSRC";
const TAG_RENDER: &[u8; 4] = b"RNDR";
const TAG_ERROR: &[u8; 4] = b"ERRO";

const MAX_HTML_BYTES: usize = 2 * 1024 * 1024;
const MAX_URL_BYTES: usize = 8 * 1024;
const MAX_ERROR_BYTES: usize = 16 * 1024;
const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;
const MAX_CSS_ITEMS: usize = 8;
const MAX_IMAGE_ITEMS: usize = 12;
const MAX_PAINT_RECTS: usize = 100_000;
const MAX_PAINT_TEXTS: usize = 200_000;
const MAX_PAINT_IMAGES: usize = 12;
const MAX_IMAGE_BYTES: usize = 12 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct LoadRequest {
    pub base_url: String,
    pub viewport_width: u32,
    pub html: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct ImageRequest {
    pub node: NodeId,
    pub source: String,
}

#[derive(Debug, Clone, Default)]
pub struct ScanResponse {
    pub css_sources: Vec<String>,
    pub images: Vec<ImageRequest>,
}

#[derive(Debug, Clone)]
pub struct ImageBlob {
    pub node: NodeId,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Default)]
pub struct ResourceBundle {
    pub css: Vec<Vec<u8>>,
    pub images: Vec<ImageBlob>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct WireRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl WireRect {
    pub fn right(self) -> u32 {
        self.x.saturating_add(self.width)
    }

    pub fn bottom(self) -> u32 {
        self.y.saturating_add(self.height)
    }

    pub fn contains(self, x: u32, y: u32) -> bool {
        x >= self.x && x < self.right() && y >= self.y && y < self.bottom()
    }
}

#[derive(Debug, Clone)]
pub struct PaintRect {
    pub rect: WireRect,
    pub color: u32,
}

#[derive(Debug, Clone)]
pub struct PaintText {
    pub rect: WireRect,
    pub text: String,
    pub color: u32,
    pub font_size: u16,
    pub link_href: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PaintImage {
    pub rect: WireRect,
    pub source_width: u32,
    pub source_height: u32,
    pub pixels: Vec<u32>,
    pub link_href: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct RenderPacket {
    pub page_background: u32,
    pub content_height: u32,
    pub rects: Vec<PaintRect>,
    pub texts: Vec<PaintText>,
    pub images: Vec<PaintImage>,
}

pub fn write_load<W: Write>(writer: &mut W, request: &LoadRequest) -> io::Result<()> {
    writer.write_all(TAG_LOAD)?;
    write_string(writer, &request.base_url)?;
    write_u32(writer, request.viewport_width)?;
    write_bytes(writer, &request.html)?;
    writer.flush()
}

pub fn read_load<R: Read>(reader: &mut R) -> io::Result<LoadRequest> {
    expect_tag(reader, TAG_LOAD)?;
    let base_url = read_string(reader, MAX_URL_BYTES)?;
    let viewport_width = read_u32(reader)?;
    if viewport_width == 0 || viewport_width > 16_384 {
        return Err(invalid("invalid renderer viewport width"));
    }
    let html = read_bytes(reader, MAX_HTML_BYTES)?;

    Ok(LoadRequest {
        base_url,
        viewport_width,
        html,
    })
}

pub fn write_scan<W: Write>(writer: &mut W, scan: &ScanResponse) -> io::Result<()> {
    writer.write_all(TAG_SCAN)?;
    write_count(writer, scan.css_sources.len(), MAX_CSS_ITEMS)?;
    for source in &scan.css_sources {
        write_string(writer, source)?;
    }

    write_count(writer, scan.images.len(), MAX_IMAGE_ITEMS)?;
    for image in &scan.images {
        write_u32(writer, image.node)?;
        write_string(writer, &image.source)?;
    }

    writer.flush()
}

pub fn read_scan<R: Read>(reader: &mut R) -> io::Result<ScanResponse> {
    let tag = read_tag(reader)?;
    if &tag == TAG_ERROR {
        return Err(remote_error(reader)?);
    }
    if &tag != TAG_SCAN {
        return Err(invalid("renderer returned an unexpected scan message"));
    }

    let css_count = read_count(reader, MAX_CSS_ITEMS)?;
    let mut css_sources = Vec::with_capacity(css_count);
    for _ in 0..css_count {
        css_sources.push(read_string(reader, MAX_URL_BYTES)?);
    }

    let image_count = read_count(reader, MAX_IMAGE_ITEMS)?;
    let mut images = Vec::with_capacity(image_count);
    for _ in 0..image_count {
        images.push(ImageRequest {
            node: read_u32(reader)?,
            source: read_string(reader, MAX_URL_BYTES)?,
        });
    }

    Ok(ScanResponse {
        css_sources,
        images,
    })
}

pub fn write_resources<W: Write>(writer: &mut W, resources: &ResourceBundle) -> io::Result<()> {
    writer.write_all(TAG_RESOURCES)?;

    write_count(writer, resources.css.len(), MAX_CSS_ITEMS)?;
    for css in &resources.css {
        write_bytes(writer, css)?;
    }

    write_count(writer, resources.images.len(), MAX_IMAGE_ITEMS)?;
    for image in &resources.images {
        write_u32(writer, image.node)?;
        write_bytes(writer, &image.bytes)?;
    }

    writer.flush()
}

pub fn read_resources<R: Read>(reader: &mut R) -> io::Result<ResourceBundle> {
    expect_tag(reader, TAG_RESOURCES)?;

    let css_count = read_count(reader, MAX_CSS_ITEMS)?;
    let mut css = Vec::with_capacity(css_count);
    for _ in 0..css_count {
        css.push(read_bytes(reader, 512 * 1024)?);
    }

    let image_count = read_count(reader, MAX_IMAGE_ITEMS)?;
    let mut images = Vec::with_capacity(image_count);
    for _ in 0..image_count {
        images.push(ImageBlob {
            node: read_u32(reader)?,
            bytes: read_bytes(reader, 1024 * 1024)?,
        });
    }

    Ok(ResourceBundle { css, images })
}

pub fn write_render<W: Write>(writer: &mut W, packet: &RenderPacket) -> io::Result<()> {
    writer.write_all(TAG_RENDER)?;
    write_u32(writer, packet.page_background)?;
    write_u32(writer, packet.content_height)?;

    write_count(writer, packet.rects.len(), MAX_PAINT_RECTS)?;
    for item in &packet.rects {
        write_rect(writer, item.rect)?;
        write_u32(writer, item.color)?;
    }

    write_count(writer, packet.texts.len(), MAX_PAINT_TEXTS)?;
    for item in &packet.texts {
        write_rect(writer, item.rect)?;
        write_u32(writer, item.color)?;
        write_u16(writer, item.font_size)?;
        write_string(writer, &item.text)?;
        write_optional_string(writer, item.link_href.as_deref())?;
    }

    write_count(writer, packet.images.len(), MAX_PAINT_IMAGES)?;
    for item in &packet.images {
        write_rect(writer, item.rect)?;
        write_u32(writer, item.source_width)?;
        write_u32(writer, item.source_height)?;
        write_u32_vector(writer, &item.pixels)?;
        write_optional_string(writer, item.link_href.as_deref())?;
    }

    writer.flush()
}

pub fn read_render<R: Read>(reader: &mut R) -> io::Result<RenderPacket> {
    let tag = read_tag(reader)?;
    if &tag == TAG_ERROR {
        return Err(remote_error(reader)?);
    }
    if &tag != TAG_RENDER {
        return Err(invalid("renderer returned an unexpected final message"));
    }

    let page_background = read_u32(reader)?;
    let content_height = read_u32(reader)?;

    let rect_count = read_count(reader, MAX_PAINT_RECTS)?;
    let mut rects = Vec::with_capacity(rect_count);
    for _ in 0..rect_count {
        rects.push(PaintRect {
            rect: read_rect(reader)?,
            color: read_u32(reader)?,
        });
    }

    let text_count = read_count(reader, MAX_PAINT_TEXTS)?;
    let mut texts = Vec::with_capacity(text_count);
    let mut total_text_bytes = 0usize;
    for _ in 0..text_count {
        let rect = read_rect(reader)?;
        let color = read_u32(reader)?;
        let font_size = read_u16(reader)?;
        let text = read_string(reader, MAX_TEXT_BYTES)?;
        total_text_bytes = total_text_bytes.saturating_add(text.len());
        if total_text_bytes > MAX_TEXT_BYTES {
            return Err(invalid("renderer text output exceeded the IPC budget"));
        }
        let link_href = read_optional_string(reader, MAX_URL_BYTES)?;
        texts.push(PaintText {
            rect,
            text,
            color,
            font_size,
            link_href,
        });
    }

    let image_count = read_count(reader, MAX_PAINT_IMAGES)?;
    let mut images = Vec::with_capacity(image_count);
    let mut total_image_bytes = 0usize;
    for _ in 0..image_count {
        let rect = read_rect(reader)?;
        let source_width = read_u32(reader)?;
        let source_height = read_u32(reader)?;
        let pixels = read_u32_vector(reader, MAX_IMAGE_BYTES / 4)?;
        total_image_bytes = total_image_bytes.saturating_add(pixels.len().saturating_mul(4));
        if total_image_bytes > MAX_IMAGE_BYTES {
            return Err(invalid("renderer image output exceeded the IPC budget"));
        }
        let link_href = read_optional_string(reader, MAX_URL_BYTES)?;
        images.push(PaintImage {
            rect,
            source_width,
            source_height,
            pixels,
            link_href,
        });
    }

    Ok(RenderPacket {
        page_background,
        content_height,
        rects,
        texts,
        images,
    })
}

pub fn write_error<W: Write>(writer: &mut W, message: &str) -> io::Result<()> {
    writer.write_all(TAG_ERROR)?;
    write_string(writer, message)?;
    writer.flush()
}

fn write_optional_string<W: Write>(writer: &mut W, value: Option<&str>) -> io::Result<()> {
    match value {
        Some(value) => {
            writer.write_all(&[1])?;
            write_string(writer, value)
        }
        None => writer.write_all(&[0]),
    }
}

fn read_optional_string<R: Read>(reader: &mut R, max: usize) -> io::Result<Option<String>> {
    let mut present = [0u8; 1];
    reader.read_exact(&mut present)?;
    match present[0] {
        0 => Ok(None),
        1 => Ok(Some(read_string(reader, max)?)),
        _ => Err(invalid("invalid optional-string marker")),
    }
}

fn write_rect<W: Write>(writer: &mut W, rect: WireRect) -> io::Result<()> {
    write_u32(writer, rect.x)?;
    write_u32(writer, rect.y)?;
    write_u32(writer, rect.width)?;
    write_u32(writer, rect.height)
}

fn read_rect<R: Read>(reader: &mut R) -> io::Result<WireRect> {
    Ok(WireRect {
        x: read_u32(reader)?,
        y: read_u32(reader)?,
        width: read_u32(reader)?,
        height: read_u32(reader)?,
    })
}

fn write_string<W: Write>(writer: &mut W, value: &str) -> io::Result<()> {
    write_bytes(writer, value.as_bytes())
}

fn read_string<R: Read>(reader: &mut R, max: usize) -> io::Result<String> {
    let bytes = read_bytes(reader, max)?;
    String::from_utf8(bytes).map_err(|_| invalid("IPC string was not valid UTF-8"))
}

fn write_bytes<W: Write>(writer: &mut W, bytes: &[u8]) -> io::Result<()> {
    let length = u32::try_from(bytes.len()).map_err(|_| invalid("IPC byte field is too large"))?;
    write_u32(writer, length)?;
    writer.write_all(bytes)
}

fn read_bytes<R: Read>(reader: &mut R, max: usize) -> io::Result<Vec<u8>> {
    let length = read_u32(reader)? as usize;
    if length > max {
        return Err(invalid("IPC byte field exceeded its safety limit"));
    }

    let mut bytes = vec![0u8; length];
    reader.read_exact(&mut bytes)?;
    Ok(bytes)
}

fn write_u32_vector<W: Write>(writer: &mut W, values: &[u32]) -> io::Result<()> {
    write_count(writer, values.len(), MAX_IMAGE_BYTES / 4)?;
    for value in values {
        write_u32(writer, *value)?;
    }
    Ok(())
}

fn read_u32_vector<R: Read>(reader: &mut R, max: usize) -> io::Result<Vec<u32>> {
    let count = read_count(reader, max)?;
    let mut values = Vec::with_capacity(count);
    for _ in 0..count {
        values.push(read_u32(reader)?);
    }
    Ok(values)
}

fn write_count<W: Write>(writer: &mut W, count: usize, max: usize) -> io::Result<()> {
    if count > max {
        return Err(invalid("IPC item count exceeded its safety limit"));
    }
    write_u32(
        writer,
        u32::try_from(count).map_err(|_| invalid("IPC item count is too large"))?,
    )
}

fn read_count<R: Read>(reader: &mut R, max: usize) -> io::Result<usize> {
    let count = read_u32(reader)? as usize;
    if count > max {
        return Err(invalid("IPC item count exceeded its safety limit"));
    }
    Ok(count)
}

fn write_u16<W: Write>(writer: &mut W, value: u16) -> io::Result<()> {
    writer.write_all(&value.to_le_bytes())
}

fn read_u16<R: Read>(reader: &mut R) -> io::Result<u16> {
    let mut bytes = [0u8; 2];
    reader.read_exact(&mut bytes)?;
    Ok(u16::from_le_bytes(bytes))
}

fn write_u32<W: Write>(writer: &mut W, value: u32) -> io::Result<()> {
    writer.write_all(&value.to_le_bytes())
}

fn read_u32<R: Read>(reader: &mut R) -> io::Result<u32> {
    let mut bytes = [0u8; 4];
    reader.read_exact(&mut bytes)?;
    Ok(u32::from_le_bytes(bytes))
}

fn read_tag<R: Read>(reader: &mut R) -> io::Result<[u8; 4]> {
    let mut tag = [0u8; 4];
    reader.read_exact(&mut tag)?;
    Ok(tag)
}

fn expect_tag<R: Read>(reader: &mut R, expected: &[u8; 4]) -> io::Result<()> {
    let actual = read_tag(reader)?;
    if &actual == expected {
        Ok(())
    } else {
        Err(invalid("unexpected IPC message tag"))
    }
}

fn remote_error<R: Read>(reader: &mut R) -> io::Result<io::Error> {
    let message = read_string(reader, MAX_ERROR_BYTES)?;
    Ok(io::Error::new(
        io::ErrorKind::Other,
        format!("renderer worker: {message}"),
    ))
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_packet_round_trip() {
        let packet = RenderPacket {
            page_background: 0xFFFFFF,
            content_height: 900,
            rects: vec![PaintRect {
                rect: WireRect {
                    x: 1,
                    y: 2,
                    width: 3,
                    height: 4,
                },
                color: 0x123456,
            }],
            texts: vec![PaintText {
                rect: WireRect {
                    x: 5,
                    y: 6,
                    width: 70,
                    height: 16,
                },
                text: "hello".into(),
                color: 0,
                font_size: 16,
                link_href: Some("/next".into()),
            }],
            images: vec![],
        };

        let mut bytes = Vec::new();
        write_render(&mut bytes, &packet).unwrap();
        let decoded = read_render(&mut bytes.as_slice()).unwrap();

        assert_eq!(decoded.content_height, 900);
        assert_eq!(decoded.texts[0].text, "hello");
        assert_eq!(decoded.texts[0].link_href.as_deref(), Some("/next"));
    }
}
