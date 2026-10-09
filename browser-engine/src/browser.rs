use crate::{
    history::History,
    ipc::{PaintText, RenderPacket, WireRect},
    navigation::Control,
    net,
    profile::Profile,
    render, renderer_process,
    tabs::{Tabs, HOME},
};
use minifb::{Key, KeyRepeat, MouseButton, MouseMode};
use std::{
    error::Error,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver, SyncSender, TrySendError},
        Arc,
    },
    thread,
};

struct Page {
    post_response: bool,
    url: String,
    packet: RenderPacket,
}
#[derive(Clone, Copy)]
enum Intent {
    Navigate,
    Back,
    Forward,
    Restore,
    Reload,
}
struct Request {
    generation: u64,
    tab: u64,
    url: String,
    intent: Intent,
    body: Option<Vec<u8>>,
}
struct Completed {
    request: Request,
    result: Result<Page, String>,
}

// One worker + one queued URL + one result. No thread/packet per tab or per click.
struct Loader {
    tx: SyncSender<Request>,
    rx: Receiver<Completed>,
    pending: Option<Request>,
    generation: u64,
    shared: Arc<AtomicU64>,
}
impl Loader {
    fn new() -> Self {
        let (tx, requests) = mpsc::sync_channel::<Request>(1);
        let (results, rx) = mpsc::sync_channel(1);
        let shared = Arc::new(AtomicU64::new(0));
        let worker_generation = shared.clone();
        thread::spawn(move || {
            while let Ok(request) = requests.recv() {
                let control = Control::new(worker_generation.clone(), request.generation);
                if control.check().is_err() {
                    continue;
                }
                let result = load_page(&request.url, request.body.as_deref(), &control)
                    .map_err(|e| e.to_string());
                if control.check().is_err()
                    && worker_generation.load(Ordering::Relaxed) != request.generation
                {
                    continue;
                }
                if results.send(Completed { request, result }).is_err() {
                    break;
                }
            }
        });
        Self {
            tx,
            rx,
            pending: None,
            generation: 0,
            shared,
        }
    }
    fn schedule(&mut self, tab: u64, url: String, intent: Intent) {
        self.generation += 1;
        self.shared.store(self.generation, Ordering::Relaxed);
        self.pending = Some(Request {
            generation: self.generation,
            tab,
            url,
            intent,
            body: None,
        });
    }
    fn cancel(&mut self) {
        self.generation += 1;
        self.shared.store(self.generation, Ordering::Relaxed);
        self.pending = None;
    }
    fn completed(&mut self, tab: u64) -> Option<Completed> {
        while let Ok(done) = self.rx.try_recv() {
            if done.request.generation == self.generation && done.request.tab == tab {
                return Some(done);
            }
        }
        None
    }
    fn pump(&mut self) {
        if let Some(request) = self.pending.take() {
            match self.tx.try_send(request) {
                Ok(()) => (),
                Err(TrySendError::Full(request)) => self.pending = Some(request),
                Err(TrySendError::Disconnected(_)) => (),
            }
        }
    }
}

pub fn run(start_url: &str) -> Result<(), Box<dyn Error>> {
    let mut tabs = Tabs::new();
    let profile_path = Profile::path();
    let mut profile = profile_path
        .as_deref()
        .and_then(|p| Profile::load(p).ok())
        .unwrap_or_default();
    let mut page = internal_page(HOME, &profile);
    let mut loader = Loader::new();
    let mut window = render::create_window()?;
    let input = std::rc::Rc::new(std::cell::RefCell::new(crate::text_input::Input::default()));
    window.set_input_callback(Box::new(crate::text_input::Callback(input.clone())));
    let mut address = String::new();
    let mut focused = false;
    let mut field_focus: Option<usize> = None;
    let mut field_replace = false;
    let mut replace = false;
    let mut status =
        Some("Prototype: static HTML/CSS only; no JavaScript or login yet".to_string());
    let mut scroll = 0;
    let mut left_was_down = false;
    let mut loading = false;
    if start_url != HOME {
        match net::normalize_address_input(start_url) {
            Ok(url) => {
                loader.schedule(tabs.current().id, url.clone(), Intent::Navigate);
                page = empty_page(&url);
                loading = true;
            }
            Err(e) => status = Some(format!("Blocked: {e}")),
        }
    }
    let mut buffer = vec![0; render::WIDTH * render::HEIGHT];
    repaint(
        &mut buffer,
        &page,
        &tabs,
        &address,
        focused,
        status.as_deref(),
        scroll,
        &profile,
        loading,
        field_focus,
    );
    while window.is_open() {
        window.update_with_buffer(&buffer, render::WIDTH, render::HEIGHT)?;
        loader.pump();
        let mut dirty = false;
        while let Some(done) = loader.completed(tabs.current().id) {
            field_focus = None;
            loading = false;
            match done.result {
                Ok(next) => {
                    let tab = tabs.current_mut();
                    match done.request.intent {
                        Intent::Navigate => tab
                            .history
                            .push_method(next.url.clone(), next.post_response),
                        Intent::Back => tab.history.commit_back(),
                        Intent::Forward => tab.history.commit_forward(),
                        Intent::Restore | Intent::Reload => (),
                    }
                    scroll = if matches!(done.request.intent, Intent::Restore) {
                        tab.scroll
                    } else {
                        0
                    };
                    tab.url = next.url.clone();
                    address = next.url.clone();
                    page = next;
                    status = None;
                    window.set_title(&format!(
                        "browser-core {} — {}",
                        env!("CARGO_PKG_VERSION"),
                        page.url
                    ));
                }
                Err(error) => {
                    page = empty_page(&done.request.url);
                    status = Some(format!(
                        "Load failed: {error}. Alt+Home opens the start page."
                    ));
                }
            }
            dirty = true;
        }
        let ctrl = window.is_key_down(Key::LeftCtrl) || window.is_key_down(Key::RightCtrl);
        let alt = window.is_key_down(Key::LeftAlt) || window.is_key_down(Key::RightAlt);
        let shift = window.is_key_down(Key::LeftShift) || window.is_key_down(Key::RightShift);
        let shortcuts: Vec<_> = input.borrow_mut().shortcuts.drain(..).collect();
        let ctrl_press = |key| shortcuts.iter().any(|s| s.ctrl && !s.alt && s.key == key);
        let alt_press = |key| shortcuts.iter().any(|s| s.alt && !s.ctrl && s.key == key);
        let press =
            |k| window.is_key_pressed(k, KeyRepeat::No) || shortcuts.iter().any(|s| s.key == k);
        let mut target: Option<(String, Intent)> = None;
        let mut post_body: Option<Vec<u8>> = None;
        let mut switch: Option<usize> = None;
        let mut create = (ctrl && press(Key::T)) || ctrl_press(Key::T);
        let mut close = (ctrl && press(Key::W)) || ctrl_press(Key::W);
        let mut bookmark = (ctrl && press(Key::D)) || ctrl_press(Key::D);
        if (ctrl && press(Key::L)) || ctrl_press(Key::L) {
            focused = true;
            field_focus = None;
            replace = true;
            address = page.url.clone();
            dirty = true;
        }
        if (ctrl && press(Key::Tab)) || ctrl_press(Key::Tab) {
            switch = Some(
                if shift
                    || shortcuts
                        .iter()
                        .any(|s| s.ctrl && s.shift && s.key == Key::Tab)
                {
                    (tabs.active + tabs.entries.len() - 1) % tabs.entries.len()
                } else {
                    (tabs.active + 1) % tabs.entries.len()
                },
            );
        }
        if (alt && press(Key::Home)) || alt_press(Key::Home) {
            target = Some((HOME.into(), Intent::Navigate));
        }
        if (ctrl && press(Key::B)) || ctrl_press(Key::B) {
            target = Some(("browser:bookmarks".into(), Intent::Navigate));
        }
        if press(Key::Escape) {
            loader.cancel();
            loading = false;
            focused = false;
            field_focus = None;
            replace = false;
            if page.packet.texts.is_empty()
                && page.packet.images.is_empty()
                && page.packet.controls.is_empty()
            {
                target = Some((tabs.current().url.clone(), Intent::Restore));
            }
            status = Some("Navigation stopped".into());
            dirty = true;
        }
        if !focused {
            if (alt && press(Key::Left)) || alt_press(Key::Left) {
                target = tabs
                    .current()
                    .history
                    .back_target()
                    .map(|u| (u.into(), Intent::Back));
            }
            if (alt && press(Key::Right)) || alt_press(Key::Right) {
                target = tabs
                    .current()
                    .history
                    .forward_target()
                    .map(|u| (u.into(), Intent::Forward));
            }
            if press(Key::F5) || ((ctrl && press(Key::R)) || ctrl_press(Key::R)) {
                target = Some((page.url.clone(), Intent::Reload));
            }
        }
        let left_down = window.get_mouse_down(MouseButton::Left);
        if left_down && !left_was_down {
            if let Some((x, y)) = window.get_mouse_pos(MouseMode::Discard) {
                match render::hit_test_navigation(
                    x.max(0.0) as u32,
                    y.max(0.0) as u32,
                    scroll,
                    &page.packet,
                ) {
                    render::NavigationHit::Tab(n) => switch = Some(n),
                    render::NavigationHit::NewTab => create = true,
                    render::NavigationHit::CloseTab => close = true,
                    render::NavigationHit::Bookmark => bookmark = true,
                    render::NavigationHit::Home => target = Some((HOME.into(), Intent::Navigate)),
                    render::NavigationHit::Back => {
                        target = tabs
                            .current()
                            .history
                            .back_target()
                            .map(|u| (u.into(), Intent::Back))
                    }
                    render::NavigationHit::Forward => {
                        target = tabs
                            .current()
                            .history
                            .forward_target()
                            .map(|u| (u.into(), Intent::Forward))
                    }
                    render::NavigationHit::Reload => {
                        target = Some((page.url.clone(), Intent::Reload))
                    }
                    render::NavigationHit::AddressBar => {
                        field_focus = None;
                        address = page.url.clone();
                        focused = true;
                        replace = true;
                        dirty = true;
                    }
                    render::NavigationHit::Control(index) => {
                        focused = false;
                        field_focus = None;
                        let control = &mut page.packet.controls[index];
                        if crate::forms::focusable(control) {
                            field_focus = Some(index);
                            field_replace = false;
                            if control.kind == crate::ipc::FIELD_CHECKBOX {
                                control.flags ^= crate::ipc::CHECKED;
                            }
                            if control.kind == crate::ipc::FIELD_SUBMIT {
                                match crate::forms::submit(
                                    &page.url,
                                    &page.packet.controls,
                                    index,
                                    Some(index),
                                ) {
                                    Ok(submission) => {
                                        post_body = submission.body;
                                        target = Some((submission.url, Intent::Navigate));
                                    }
                                    Err(error) => status = Some(error),
                                }
                            }
                        }
                        dirty = true;
                    }
                    render::NavigationHit::Link(href) => {
                        // Internal actions can only originate on broker-created internal pages.
                        if page.url.starts_with("browser:")
                            && matches!(href.as_str(), HOME | "browser:bookmarks")
                        {
                            target = Some((href, Intent::Navigate));
                        } else {
                            match net::resolve_https_url(&page.url, &href) {
                                Ok(url) => target = Some((url, Intent::Navigate)),
                                Err(e) => {
                                    status = Some(format!("Link blocked: {e}"));
                                    dirty = true;
                                }
                            }
                        }
                    }
                    render::NavigationHit::None => {
                        if field_focus.take().is_some() {
                            dirty = true;
                        }
                        if focused {
                            focused = false;
                            dirty = true;
                        }
                    }
                }
            }
        }
        left_was_down = left_down;
        if bookmark && !loading {
            let before = profile.bookmarks.clone();
            let saved = profile.toggle(&page.url).and_then(|_| {
                let path = profile_path
                    .as_deref()
                    .ok_or("No profile directory is available")?;
                profile.save(path).map_err(|e| e.to_string())
            });
            if saved.is_err() {
                profile.bookmarks = before;
            }
            status = Some(match saved {
                Ok(()) => "Bookmarks updated (Ctrl+B to open)".into(),
                Err(e) => format!("Bookmark failed: {e}"),
            });
            dirty = true;
        }
        if create || close || switch.is_some() {
            tabs.current_mut().scroll = scroll;
            let changed = if create {
                tabs.open(HOME.into())
            } else if close {
                tabs.close();
                true
            } else {
                tabs.select(switch.unwrap())
            };
            if changed {
                loader.cancel();
                target = Some((tabs.current().url.clone(), Intent::Restore));
            } else if create {
                status = Some("Tab limit reached (16)".into());
                dirty = true;
            }
        }
        if !focused && !ctrl && !ctrl_press(Key::Tab) && press(Key::Tab) {
            field_focus = crate::forms::next_focus(
                &page.packet.controls,
                field_focus,
                shift || shortcuts.iter().any(|s| s.key == Key::Tab && s.shift),
            );
            field_replace = false;
            if let Some(index) = field_focus {
                scroll = page.packet.controls[index].rect.y.saturating_sub(40).min(
                    page.packet
                        .content_height
                        .saturating_sub(render::PAGE_VIEW_HEIGHT),
                );
            }
            dirty = true;
        }
        if let Some(index) = field_focus {
            if let Some(field) = page.packet.controls.get_mut(index) {
                if (ctrl && press(Key::A)) || ctrl_press(Key::A) {
                    field_replace = true;
                    dirty = true;
                }
                if (ctrl && press(Key::V)) || ctrl_press(Key::V) {
                    match crate::clipboard::read_text() {
                        Ok(text) => {
                            if crate::forms::append(field, &text, field_replace) {
                                field_replace = false;
                            } else {
                                status = Some(
                                    "Pasted field exceeds its limit or cannot be edited".into(),
                                );
                            }
                        }
                        Err(error) => status = Some(error),
                    }
                    dirty = true;
                }
                for ch in input.borrow_mut().chars.drain(..) {
                    if ctrl || alt {
                        continue;
                    }
                    if crate::forms::append(field, &ch.to_string(), field_replace) {
                        field_replace = false;
                        dirty = true;
                    }
                }
                if crate::forms::editable(field)
                    && (window.is_key_pressed(Key::Backspace, KeyRepeat::Yes)
                        || press(Key::Backspace))
                {
                    if field_replace {
                        field.value.clear();
                        field_replace = false;
                    } else {
                        field.value.pop();
                    }
                    dirty = true;
                }
                if field.kind == crate::ipc::FIELD_CHECKBOX && press(Key::Space) {
                    field.flags ^= crate::ipc::CHECKED;
                    dirty = true;
                }
            }
            if press(Key::Enter) {
                let owner = page.packet.controls[index].form;
                let submitter = page.packet.controls.iter().position(|c| {
                    c.form == owner
                        && c.kind == crate::ipc::FIELD_SUBMIT
                        && c.flags & crate::ipc::DISABLED == 0
                });
                match crate::forms::submit(&page.url, &page.packet.controls, index, submitter) {
                    Ok(submission) => {
                        post_body = submission.body;
                        target = Some((submission.url, Intent::Navigate));
                    }
                    Err(error) => status = Some(error),
                }
                dirty = true;
            }
        }
        if focused {
            if (ctrl && press(Key::A)) || ctrl_press(Key::A) {
                replace = true;
                dirty = true;
            }
            if (ctrl && press(Key::V)) || ctrl_press(Key::V) {
                match crate::clipboard::read_text() {
                    Ok(text)
                        if (if replace { 0 } else { address.len() }) + text.len()
                            <= net::MAX_URL_BYTES =>
                    {
                        if replace {
                            address.clear();
                            replace = false;
                        }
                        address.push_str(&text);
                        dirty = true;
                    }
                    Ok(_) => {
                        status = Some("Pasted address is too long".into());
                        dirty = true;
                    }
                    Err(error) => {
                        status = Some(error);
                        dirty = true;
                    }
                }
            }
            for ch in input.borrow_mut().chars.drain(..) {
                if ctrl || alt {
                    continue;
                }
                if replace {
                    address.clear();
                    replace = false;
                }
                if address.len() + ch.len_utf8() <= net::MAX_URL_BYTES {
                    address.push(ch);
                    dirty = true;
                }
            }
            if press(Key::Enter) {
                match net::normalize_address_input(&address) {
                    Ok(url) => target = Some((url, Intent::Navigate)),
                    Err(e) => {
                        status = Some(format!("Blocked: {e}"));
                        dirty = true;
                    }
                }
            }
            if window.is_key_pressed(Key::Backspace, KeyRepeat::Yes) || press(Key::Backspace) {
                if replace {
                    address.clear();
                    replace = false;
                } else {
                    address.pop();
                }
                dirty = true;
            }
        } else if field_focus.is_none() {
            let max = page
                .packet
                .content_height
                .saturating_sub(render::PAGE_VIEW_HEIGHT);
            let mut delta = 0i64;
            if let Some((_, wheel)) = window.get_scroll_wheel() {
                delta += (-wheel * 52.0) as i64;
            }
            if window.is_key_pressed(Key::PageDown, KeyRepeat::Yes) {
                delta += render::PAGE_VIEW_HEIGHT as i64 * 4 / 5;
            }
            if window.is_key_pressed(Key::PageUp, KeyRepeat::Yes) {
                delta -= render::PAGE_VIEW_HEIGHT as i64 * 4 / 5;
            }
            if !alt && window.is_key_pressed(Key::Down, KeyRepeat::Yes) {
                delta += 40;
            }
            if !alt && window.is_key_pressed(Key::Up, KeyRepeat::Yes) {
                delta -= 40;
            }
            let next = scroll_target(
                scroll,
                max,
                delta,
                press(Key::Home) && !alt && !alt_press(Key::Home),
                press(Key::End),
            );
            if next != scroll {
                scroll = next;
                dirty = true;
            }
        }
        input.borrow_mut().chars.clear();
        if let Some((url, intent)) = target {
            field_focus = None;
            focused = false;
            replace = false;
            let history = &tabs.current().history;
            let requires_submission = match intent {
                Intent::Restore | Intent::Reload => history.current_requires_submission(),
                Intent::Back => history.back_requires_submission(),
                Intent::Forward => history.forward_requires_submission(),
                Intent::Navigate => false,
            };
            if requires_submission && post_body.is_none() {
                loader.cancel();
                loading = false;
                let tab = tabs.current_mut();
                match intent {
                    Intent::Back => tab.history.commit_back(),
                    Intent::Forward => tab.history.commit_forward(),
                    _ => (),
                }
                tab.url = url.clone();
                page = empty_page(&url);
                scroll = 0;
                status = Some("POST result expired. Return to the form and submit again; data was not retained or resent.".into());
            } else if matches!(url.as_str(), HOME | "browser:bookmarks") {
                loader.cancel();
                loading = false;
                let tab = tabs.current_mut();
                match intent {
                    Intent::Navigate => tab.history.push(url.clone()),
                    Intent::Back => tab.history.commit_back(),
                    Intent::Forward => tab.history.commit_forward(),
                    _ => (),
                }
                tab.url = url.clone();
                page = internal_page(&url, &profile);
                scroll = 0;
                status = None;
            } else {
                loader.schedule(tabs.current().id, url.clone(), intent);
                if let Some(request) = loader.pending.as_mut() {
                    request.body = post_body;
                }
                page = empty_page(&url);
                scroll = 0;
                loading = true;
                status = Some("Loading securely... Esc stops; tabs remain responsive".into());
            }
            address = url;
            dirty = true;
        }
        if dirty {
            repaint(
                &mut buffer,
                &page,
                &tabs,
                &address,
                focused,
                status.as_deref(),
                scroll,
                &profile,
                loading,
                field_focus,
            );
        }
    }
    loader.cancel();
    Ok(())
}

fn scroll_target(current: u32, max: u32, delta: i64, home: bool, end: bool) -> u32 {
    if end {
        max
    } else if home {
        0
    } else {
        (current as i64 + delta).clamp(0, max as i64) as u32
    }
}

#[allow(clippy::too_many_arguments)]
fn repaint(
    buffer: &mut [u32],
    page: &Page,
    tabs: &Tabs,
    address: &str,
    focused: bool,
    status: Option<&str>,
    scroll: u32,
    profile: &Profile,
    loading: bool,
    field_focus: Option<usize>,
) {
    let history: &History = &tabs.current().history;
    render::paint_into(
        buffer,
        &page.url,
        address,
        focused,
        status,
        scroll,
        &page.packet,
        history.can_back(),
        history.can_forward(),
    );
    render::paint_tabs(
        buffer,
        &tabs
            .entries
            .iter()
            .map(|t| t.url.as_str())
            .collect::<Vec<_>>(),
        tabs.active,
        profile.bookmarks.contains(&page.url),
        loading,
    );
    render::paint_controls(buffer, &page.packet, scroll, field_focus);
}
fn empty_page(url: &str) -> Page {
    Page {
        url: url.into(),
        post_response: false,
        packet: RenderPacket {
            page_background: 0xFAFCFF,
            ..Default::default()
        },
    }
}
fn internal_page(url: &str, profile: &Profile) -> Page {
    let mut page = empty_page(url);
    let lines: Vec<(String, Option<String>)> = if url == "browser:bookmarks" {
        std::iter::once((
            "Bookmarks - Ctrl+D adds/removes the current HTTPS page".into(),
            None,
        ))
        .chain(
            profile
                .bookmarks
                .iter()
                .map(|u| (u.clone(), Some(u.clone()))),
        )
        .collect()
    } else {
        vec![
            ("browser-core: independent engine".into(), None),
            (
                "Type an HTTPS address or search terms in the address bar (Ctrl+L).".into(),
                None,
            ),
            (
                "New tab: Ctrl+T | Close tab: Ctrl+W | Switch: Ctrl+Tab".into(),
                None,
            ),
            (
                "Inactive tabs retain URLs only. Switching reloads the page.".into(),
                None,
            ),
            ("Bookmarks".into(), Some("browser:bookmarks".into())),
            ("Example page".into(), Some("https://example.com/".into())),
            (
                "Compatibility: basic HTML/CSS, forms and PNG/JPEG.".into(),
                None,
            ),
            (
                "JavaScript, cookies, login sessions, media and extensions are not supported yet."
                    .into(),
                None,
            ),
        ]
    };
    for (i, (text, link_href)) in lines.into_iter().enumerate() {
        page.packet.texts.push(PaintText {
            rect: WireRect {
                x: 12,
                y: 24 + i as u32 * 32,
                width: crate::text_metrics::width(&text).saturating_mul(8),
                height: 16,
            },
            text,
            color: 0x25374D,
            font_size: 16,
            link_href,
        });
    }
    page.packet.content_height = page.packet.texts.len() as u32 * 32 + 60;
    page
}
fn load_page(target: &str, body: Option<&[u8]>, control: &Control) -> Result<Page, Box<dyn Error>> {
    let response = if let Some(body) = body {
        net::fetch_post(target, body, control)?
    } else {
        net::fetch_document(target, control)?
    };
    if !(200..300).contains(&response.status) {
        return Err(format!("HTTP status {}", response.status).into());
    }
    if let Some(mime) = response.content_type.as_deref() {
        if !matches!(
            mime.split(';').next().unwrap_or("").trim(),
            "text/html" | "application/xhtml+xml"
        ) {
            return Err("Unsupported document type; only HTML pages are rendered".into());
        }
    }
    let packet = renderer_process::render_page_controlled(
        &response.final_url,
        &response.body,
        render::PAGE_WIDTH,
        Some(control),
    )?;
    Ok(Page {
        url: response.final_url,
        post_response: response.was_post,
        packet,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scroll_moves_and_stays_in_place_without_a_home_press() {
        assert_eq!(scroll_target(100, 1000, 52, false, false), 152);
        assert_eq!(scroll_target(152, 1000, 0, false, false), 152);
        assert_eq!(scroll_target(152, 1000, -52, false, false), 100);
        assert_eq!(scroll_target(152, 1000, 0, true, false), 0);
        assert_eq!(scroll_target(152, 1000, 0, false, true), 1000);
        assert_eq!(scroll_target(900, 1000, 500, false, false), 1000);
        assert_eq!(scroll_target(100, 1000, -500, false, false), 0);
    }
    fn mock_loader() -> (Loader, SyncSender<Completed>) {
        let (tx, _rx) = mpsc::sync_channel(1);
        let (result, rx) = mpsc::sync_channel(4);
        (
            Loader {
                tx,
                rx,
                pending: None,
                generation: 0,
                shared: Arc::new(AtomicU64::new(0)),
            },
            result,
        )
    }
    fn done(generation: u64, tab: u64) -> Completed {
        Completed {
            request: Request {
                generation,
                tab,
                url: "https://example.com/".into(),
                intent: Intent::Navigate,
                body: None,
            },
            result: Ok(empty_page("https://example.com/")),
        }
    }
    #[test]
    fn newest_pending_url_replaces_previous() {
        let (mut loader, _) = mock_loader();
        loader.schedule(1, "https://a.test/".into(), Intent::Navigate);
        loader.schedule(1, "https://b.test/".into(), Intent::Navigate);
        assert_eq!(loader.pending.as_ref().unwrap().url, "https://b.test/");
    }
    #[test]
    fn cancelled_and_other_tab_results_never_display() {
        let (mut loader, result) = mock_loader();
        loader.schedule(1, "https://a.test/".into(), Intent::Navigate);
        loader.cancel();
        loader.schedule(2, "https://b.test/".into(), Intent::Navigate);
        result.send(done(1, 1)).unwrap();
        result.send(done(3, 1)).unwrap();
        result.send(done(3, 2)).unwrap();
        let accepted = loader.completed(2).unwrap();
        assert_eq!(accepted.request.tab, 2);
        assert!(loader.completed(2).is_none());
    }
}
