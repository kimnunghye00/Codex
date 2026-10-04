use crate::history::History;
use crate::ipc::RenderPacket;
use crate::{net, render, renderer_process};
use minifb::{Key, KeyRepeat, MouseButton, MouseMode};
use std::error::Error;

struct Page {
    url: String,
    packet: RenderPacket,
}

pub fn run(start_url: &str) -> Result<(), Box<dyn Error>> {
    let mut page = load_page(start_url)?;
    let mut history = History::new();
    history.push(page.url.clone());

    let mut window = render::create_window()?;
    let mut address_text = page.url.clone();
    let mut address_focused = false;
    let mut replace_address_on_type = false;
    let mut status: Option<String> = None;
    let mut scroll_y = 0u32;
    let mut left_was_down = false;

    let mut buffer = repaint(
        &page,
        &history,
        &address_text,
        address_focused,
        status.as_deref(),
        scroll_y,
    );

    while window.is_open() {
        window.update_with_buffer(&buffer, render::WIDTH, render::HEIGHT)?;

        let ctrl_down =
            window.is_key_down(Key::LeftCtrl) || window.is_key_down(Key::RightCtrl);
        let alt_down =
            window.is_key_down(Key::LeftAlt) || window.is_key_down(Key::RightAlt);
        let shift_down =
            window.is_key_down(Key::LeftShift) || window.is_key_down(Key::RightShift);

        let ctrl_l = ctrl_down && window.is_key_pressed(Key::L, KeyRepeat::No);
        let back_key = alt_down && window.is_key_pressed(Key::Left, KeyRepeat::No);
        let forward_key = alt_down && window.is_key_pressed(Key::Right, KeyRepeat::No);
        let reload_key = window.is_key_pressed(Key::F5, KeyRepeat::No);
        let escape_key = window.is_key_pressed(Key::Escape, KeyRepeat::No);

        let left_down = window.get_mouse_down(MouseButton::Left);
        let clicked = left_down && !left_was_down;
        left_was_down = left_down;

        let mut command = Command::None;
        let mut needs_repaint = false;

        if ctrl_l {
            address_text = page.url.clone();
            address_focused = true;
            replace_address_on_type = true;
            status = None;
            needs_repaint = true;
        } else if escape_key {
            if address_focused {
                address_focused = false;
                address_text = page.url.clone();
                replace_address_on_type = false;
                status = None;
                needs_repaint = true;
            } else {
                break;
            }
        } else if !address_focused {
            if back_key {
                command = Command::Back;
            } else if forward_key {
                command = Command::Forward;
            } else if reload_key {
                command = Command::Reload;
            }
        }

        if clicked {
            if let Some((mouse_x, mouse_y)) = window.get_mouse_pos(MouseMode::Discard) {
                if mouse_x >= 0.0 && mouse_y >= 0.0 {
                    match render::hit_test_navigation(
                        mouse_x as u32,
                        mouse_y as u32,
                        scroll_y,
                        &page.packet,
                    ) {
                        render::NavigationHit::Back => {
                            address_focused = false;
                            command = Command::Back;
                        }
                        render::NavigationHit::Forward => {
                            address_focused = false;
                            command = Command::Forward;
                        }
                        render::NavigationHit::AddressBar => {
                            address_text = page.url.clone();
                            address_focused = true;
                            replace_address_on_type = true;
                            status = None;
                            needs_repaint = true;
                        }
                        render::NavigationHit::Link(href) => {
                            address_focused = false;
                            match net::resolve_https_url(&page.url, &href) {
                                Ok(target) => command = Command::Address(target),
                                Err(error) => {
                                    status = Some(format!("Link blocked: {error}"));
                                    needs_repaint = true;
                                }
                            }
                        }
                        render::NavigationHit::None => {
                            if address_focused {
                                address_focused = false;
                                address_text = page.url.clone();
                                replace_address_on_type = false;
                                needs_repaint = true;
                            }
                        }
                    }
                }
            }
        }

        if address_focused {
            if window.is_key_pressed(Key::Enter, KeyRepeat::No) {
                match net::normalize_address_input(&address_text) {
                    Ok(target) => command = Command::Address(target),
                    Err(error) => {
                        status = Some(format!("Blocked: {error}"));
                        needs_repaint = true;
                    }
                }
            }

            if window.is_key_pressed(Key::Backspace, KeyRepeat::Yes) {
                if replace_address_on_type {
                    address_text.clear();
                    replace_address_on_type = false;
                } else {
                    address_text.pop();
                }
                needs_repaint = true;
            }

            for key in window.get_keys_pressed(KeyRepeat::Yes) {
                if matches!(key, Key::Enter | Key::Backspace | Key::Escape)
                    || ctrl_down
                    || alt_down
                {
                    continue;
                }

                if let Some(ch) = key_to_address_char(key, shift_down) {
                    if replace_address_on_type {
                        address_text.clear();
                        replace_address_on_type = false;
                    }

                    if address_text.len() < net::MAX_URL_BYTES {
                        address_text.push(ch);
                        needs_repaint = true;
                    }
                }
            }
        } else {
            let max_scroll = page
                .packet
                .content_height
                .saturating_sub(render::PAGE_VIEW_HEIGHT);

            if let Some((_, wheel_y)) = window.get_scroll_wheel() {
                if wheel_y.abs() > f32::EPSILON {
                    let delta = (-wheel_y * 52.0) as i64;
                    scroll_y = clamp_scroll(scroll_y as i64 + delta, max_scroll);
                    needs_repaint = true;
                }
            }

            if window.is_key_pressed(Key::PageDown, KeyRepeat::Yes) {
                scroll_y = clamp_scroll(
                    scroll_y as i64 + (render::PAGE_VIEW_HEIGHT as i64 * 4 / 5),
                    max_scroll,
                );
                needs_repaint = true;
            }

            if window.is_key_pressed(Key::PageUp, KeyRepeat::Yes) {
                scroll_y = clamp_scroll(
                    scroll_y as i64 - (render::PAGE_VIEW_HEIGHT as i64 * 4 / 5),
                    max_scroll,
                );
                needs_repaint = true;
            }

            if !alt_down && window.is_key_pressed(Key::Down, KeyRepeat::Yes) {
                scroll_y = clamp_scroll(scroll_y as i64 + 40, max_scroll);
                needs_repaint = true;
            }

            if !alt_down && window.is_key_pressed(Key::Up, KeyRepeat::Yes) {
                scroll_y = clamp_scroll(scroll_y as i64 - 40, max_scroll);
                needs_repaint = true;
            }

            if window.is_key_pressed(Key::Home, KeyRepeat::No) {
                scroll_y = 0;
                needs_repaint = true;
            }

            if window.is_key_pressed(Key::End, KeyRepeat::No) {
                scroll_y = max_scroll;
                needs_repaint = true;
            }
        }

        let changed = match command {
            Command::None => false,
            Command::Reload => match load_page(&page.url) {
                Ok(next) => {
                    page = next;
                    true
                }
                Err(error) => {
                    status = Some(format!("Reload failed: {error}"));
                    false
                }
            },
            Command::Back => {
                if let Some(target) = history.back_target().map(str::to_string) {
                    match load_page(&target) {
                        Ok(next) => {
                            page = next;
                            history.commit_back();
                            true
                        }
                        Err(error) => {
                            status = Some(format!("Back failed: {error}"));
                            false
                        }
                    }
                } else {
                    false
                }
            }
            Command::Forward => {
                if let Some(target) = history.forward_target().map(str::to_string) {
                    match load_page(&target) {
                        Ok(next) => {
                            page = next;
                            history.commit_forward();
                            true
                        }
                        Err(error) => {
                            status = Some(format!("Forward failed: {error}"));
                            false
                        }
                    }
                } else {
                    false
                }
            }
            Command::Address(target) => match load_page(&target) {
                Ok(next) => {
                    history.push(next.url.clone());
                    page = next;
                    true
                }
                Err(error) => {
                    status = Some(format!("Navigation blocked/failed: {error}"));
                    false
                }
            },
        };

        if changed {
            scroll_y = 0;
            address_text = page.url.clone();
            address_focused = false;
            replace_address_on_type = false;
            status = None;
            window.set_title(&format!("browser-core 0.7 — {}", page.url));
            needs_repaint = true;
        }

        if needs_repaint {
            buffer = repaint(
                &page,
                &history,
                &address_text,
                address_focused,
                status.as_deref(),
                scroll_y,
            );
        }
    }

    Ok(())
}

fn repaint(
    page: &Page,
    history: &History,
    address_text: &str,
    address_focused: bool,
    status: Option<&str>,
    scroll_y: u32,
) -> Vec<u32> {
    render::paint(
        &page.url,
        address_text,
        address_focused,
        status,
        scroll_y,
        &page.packet,
        history.can_back(),
        history.can_forward(),
    )
}

fn load_page(target: &str) -> Result<Page, Box<dyn Error>> {
    println!("[browser-core] broker GET {target}");

    let response = net::fetch_https(target)?;

    println!(
        "[browser-core] broker HTTP {} | {} bytes | final {}",
        response.status,
        response.body.len(),
        response.final_url
    );

    if !(200..300).contains(&response.status) {
        return Err(format!("HTTP status {}", response.status).into());
    }

    let packet = renderer_process::render_page(
        &response.final_url,
        &response.body,
        render::PAGE_WIDTH,
    )?;

    println!(
        "[browser-core] renderer packet: {} rects | {} texts | {} images | {}px",
        packet.rects.len(),
        packet.texts.len(),
        packet.images.len(),
        packet.content_height
    );

    Ok(Page {
        url: response.final_url,
        packet,
    })
}

fn clamp_scroll(value: i64, max: u32) -> u32 {
    value.clamp(0, max as i64) as u32
}

fn key_to_address_char(key: Key, shift: bool) -> Option<char> {
    let letter = match key {
        Key::A => Some('a'),
        Key::B => Some('b'),
        Key::C => Some('c'),
        Key::D => Some('d'),
        Key::E => Some('e'),
        Key::F => Some('f'),
        Key::G => Some('g'),
        Key::H => Some('h'),
        Key::I => Some('i'),
        Key::J => Some('j'),
        Key::K => Some('k'),
        Key::L => Some('l'),
        Key::M => Some('m'),
        Key::N => Some('n'),
        Key::O => Some('o'),
        Key::P => Some('p'),
        Key::Q => Some('q'),
        Key::R => Some('r'),
        Key::S => Some('s'),
        Key::T => Some('t'),
        Key::U => Some('u'),
        Key::V => Some('v'),
        Key::W => Some('w'),
        Key::X => Some('x'),
        Key::Y => Some('y'),
        Key::Z => Some('z'),
        _ => None,
    };

    if let Some(ch) = letter {
        return Some(if shift {
            ch.to_ascii_uppercase()
        } else {
            ch
        });
    }

    match (key, shift) {
        (Key::Key0, false) => Some('0'),
        (Key::Key0, true) => Some(')'),
        (Key::Key1, false) => Some('1'),
        (Key::Key1, true) => Some('!'),
        (Key::Key2, false) => Some('2'),
        (Key::Key2, true) => Some('@'),
        (Key::Key3, false) => Some('3'),
        (Key::Key3, true) => Some('#'),
        (Key::Key4, false) => Some('4'),
        (Key::Key4, true) => Some('$'),
        (Key::Key5, false) => Some('5'),
        (Key::Key5, true) => Some('%'),
        (Key::Key6, false) => Some('6'),
        (Key::Key6, true) => Some('^'),
        (Key::Key7, false) => Some('7'),
        (Key::Key7, true) => Some('&'),
        (Key::Key8, false) => Some('8'),
        (Key::Key8, true) => Some('*'),
        (Key::Key9, false) => Some('9'),
        (Key::Key9, true) => Some('('),
        (Key::Period, _) => Some('.'),
        (Key::Slash, false) => Some('/'),
        (Key::Slash, true) => Some('?'),
        (Key::Semicolon, false) => Some(';'),
        (Key::Semicolon, true) => Some(':'),
        (Key::Minus, false) => Some('-'),
        (Key::Minus, true) => Some('_'),
        (Key::Equal, false) => Some('='),
        (Key::Equal, true) => Some('+'),
        (Key::Comma, false) => Some(','),
        (Key::Comma, true) => Some('<'),
        (Key::LeftBracket, false) => Some('['),
        (Key::LeftBracket, true) => Some('{'),
        (Key::RightBracket, false) => Some(']'),
        (Key::RightBracket, true) => Some('}'),
        _ => None,
    }
}

#[derive(Debug)]
enum Command {
    None,
    Reload,
    Back,
    Forward,
    Address(String),
}
