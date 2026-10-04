use crate::css::Stylesheet;
use crate::dom::{Document, NodeId, NodeKind};
use crate::history::History;
use crate::{html, layout, net, render, style};
use minifb::{Key, KeyRepeat, MouseButton, MouseMode};
use std::error::Error;

struct Page {
    url: String,
    document: Document,
    styles: Vec<style::ComputedStyle>,
    layout: layout::LayoutTree,
}

pub fn run(start_url: &str) -> Result<(), Box<dyn Error>> {
    let mut page = load_page(start_url)?;
    let mut history = History::new();
    history.push(page.url.clone());

    let mut window = render::create_window()?;
    let mut buffer = render::paint(
        &page.url,
        &page.document,
        &page.styles,
        &page.layout,
        history.can_back(),
        history.can_forward(),
    );

    let mut left_was_down = false;

    while window.is_open() && !window.is_key_down(Key::Escape) {
        window.update_with_buffer(&buffer, render::WIDTH, render::HEIGHT)?;

        let alt_down = window.is_key_down(Key::LeftAlt) || window.is_key_down(Key::RightAlt);
        let back_key = alt_down && window.is_key_pressed(Key::Left, KeyRepeat::No);
        let forward_key = alt_down && window.is_key_pressed(Key::Right, KeyRepeat::No);
        let reload_key = window.is_key_pressed(Key::F5, KeyRepeat::No);

        let left_down = window.get_mouse_down(MouseButton::Left);
        let clicked = left_down && !left_was_down;
        left_was_down = left_down;

        let mut command = if back_key {
            Command::Back
        } else if forward_key {
            Command::Forward
        } else if reload_key {
            Command::Reload
        } else {
            Command::None
        };

        if clicked {
            if let Some((mouse_x, mouse_y)) = window.get_mouse_pos(MouseMode::Discard) {
                if mouse_x >= 0.0 && mouse_y >= 0.0 {
                    command = match render::hit_test_navigation(
                        mouse_x as u32,
                        mouse_y as u32,
                        &page.layout,
                    ) {
                        render::NavigationHit::Back => Command::Back,
                        render::NavigationHit::Forward => Command::Forward,
                        render::NavigationHit::Link(node) => Command::Link(node),
                        render::NavigationHit::None => command,
                    };
                }
            }
        }

        let changed = match command {
            Command::None => false,
            Command::Reload => {
                match load_page(&page.url) {
                    Ok(next) => {
                        page = next;
                        true
                    }
                    Err(error) => {
                        eprintln!("[browser-core] reload blocked/failed: {error}");
                        false
                    }
                }
            }
            Command::Back => {
                let Some(target) = history.back_target().map(str::to_string) else {
                    continue;
                };
                match load_page(&target) {
                    Ok(next) => {
                        page = next;
                        history.commit_back();
                        true
                    }
                    Err(error) => {
                        eprintln!("[browser-core] back navigation failed: {error}");
                        false
                    }
                }
            }
            Command::Forward => {
                let Some(target) = history.forward_target().map(str::to_string) else {
                    continue;
                };
                match load_page(&target) {
                    Ok(next) => {
                        page = next;
                        history.commit_forward();
                        true
                    }
                    Err(error) => {
                        eprintln!("[browser-core] forward navigation failed: {error}");
                        false
                    }
                }
            }
            Command::Link(node) => {
                let Some(target) = resolve_link(&page, node) else {
                    continue;
                };

                match load_page(&target) {
                    Ok(next) => {
                        history.push(next.url.clone());
                        page = next;
                        true
                    }
                    Err(error) => {
                        eprintln!("[browser-core] link navigation blocked/failed: {error}");
                        false
                    }
                }
            }
        };

        if changed {
            window.set_title(&format!("browser-core 0.5 — {}", page.url));
            buffer = render::paint(
                &page.url,
                &page.document,
                &page.styles,
                &page.layout,
                history.can_back(),
                history.can_forward(),
            );
        }
    }

    Ok(())
}

fn load_page(target: &str) -> Result<Page, Box<dyn Error>> {
    println!("[browser-core] GET {target}");
    let response = net::fetch_https(target)?;
    println!(
        "[browser-core] HTTP {} | {} bytes | final {}",
        response.status,
        response.body.len(),
        response.final_url
    );

    let source = String::from_utf8_lossy(&response.body);
    let document = html::parse(&source)?;
    let stylesheet = Stylesheet::from_document(&document)?;
    let styles = style::compute(&document, &stylesheet);
    let layout = layout::build(&document, &styles, render::PAGE_WIDTH)?;

    println!(
        "[browser-core] DOM {} nodes | CSS {} rules | layout {} fragments",
        document.len(),
        stylesheet.rules.len(),
        layout.fragments.len()
    );

    Ok(Page {
        url: response.final_url,
        document,
        styles,
        layout,
    })
}

fn resolve_link(page: &Page, node: NodeId) -> Option<String> {
    let node = page.document.node(node)?;
    let NodeKind::Element(element) = node.kind() else {
        return None;
    };

    if element.tag_name() != "a" {
        return None;
    }

    let href = element.attribute("href")?;
    match net::resolve_https_url(&page.url, href) {
        Ok(url) => Some(url),
        Err(error) => {
            eprintln!("[browser-core] blocked link {href:?}: {error}");
            None
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum Command {
    None,
    Reload,
    Back,
    Forward,
    Link(NodeId),
}
