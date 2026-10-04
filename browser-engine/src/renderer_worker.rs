use crate::dom::{Document, NodeId, NodeKind};
use crate::ipc::{
    self, PaintImage, PaintRect, PaintText, RenderPacket, WireRect,
};
use crate::{html, layout, resources, style};
use std::error::Error;
use std::io::{self, BufReader, BufWriter};

const DEFAULT_BACKGROUND: u32 = 0xF7F7F7;
const MAX_LINK_BYTES: usize = 8 * 1024;

pub fn run() -> Result<(), Box<dyn Error>> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut writer = BufWriter::new(stdout.lock());

    ipc::write_ready(&mut writer)?;

    match run_inner(&mut reader, &mut writer) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = ipc::write_error(&mut writer, &error.to_string());
            Err(error)
        }
    }
}

fn run_inner<R: io::Read, W: io::Write>(
    reader: &mut R,
    writer: &mut W,
) -> Result<(), Box<dyn Error>> {
    let request = ipc::read_load(reader)?;
    let source = String::from_utf8_lossy(&request.html);
    let document = html::parse(&source)?;

    let scan = resources::scan_requests(&document);
    ipc::write_scan(writer, &scan)?;

    let bundle = ipc::read_resources(reader)?;
    let stylesheet = resources::build_stylesheet(&document, &bundle.css)?;
    let images = resources::decode_images(&bundle.images);
    let styles = style::compute(&document, &stylesheet);
    let layout = layout::build(
        &document,
        &styles,
        &images,
        request.viewport_width,
    )?;

    let packet = build_packet(&document, &styles, &layout, &images);
    ipc::write_render(writer, &packet)?;
    Ok(())
}

fn build_packet(
    document: &Document,
    styles: &[style::ComputedStyle],
    layout: &layout::LayoutTree,
    resources: &resources::ResourceSet,
) -> RenderPacket {
    let page_background = document
        .find_first_element("body")
        .and_then(|id| styles.get(id as usize))
        .and_then(|style| style.background_color)
        .unwrap_or(DEFAULT_BACKGROUND);

    let rects = layout
        .boxes
        .iter()
        .flatten()
        .filter_map(|layout_box| {
            let color = styles
                .get(layout_box.node as usize)?
                .background_color?;
            Some(PaintRect {
                rect: to_wire_rect(layout_box.rect),
                color,
            })
        })
        .collect();

    let texts = layout
        .fragments
        .iter()
        .map(|fragment| {
            let computed = styles
                .get(fragment.node as usize)
                .copied()
                .unwrap_or_default();

            PaintText {
                rect: to_wire_rect(fragment.rect),
                text: fragment.text.to_string(),
                color: computed.color,
                font_size: computed.font_size,
                link_href: fragment
                    .link
                    .and_then(|id| raw_link_href(document, id)),
            }
        })
        .collect();

    let images = layout
        .images
        .iter()
        .filter_map(|fragment| {
            let resource = resources.image(fragment.node)?;
            Some(PaintImage {
                rect: to_wire_rect(fragment.rect),
                source_width: resource.width,
                source_height: resource.height,
                pixels: resource.pixels.clone(),
                link_href: fragment
                    .link
                    .and_then(|id| raw_link_href(document, id)),
            })
        })
        .collect();

    RenderPacket {
        page_background,
        content_height: layout.content_height,
        rects,
        texts,
        images,
    }
}

fn raw_link_href(document: &Document, node: NodeId) -> Option<String> {
    let node = document.node(node)?;
    let NodeKind::Element(element) = node.kind() else {
        return None;
    };

    if element.tag_name() != "a" {
        return None;
    }

    let href = element.attribute("href")?;
    if href.is_empty() || href.len() > MAX_LINK_BYTES {
        return None;
    }

    Some(href.to_string())
}

fn to_wire_rect(rect: layout::Rect) -> WireRect {
    WireRect {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
    }
}
