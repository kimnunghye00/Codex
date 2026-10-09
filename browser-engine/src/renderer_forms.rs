//! The renderer describes controls; only the broker edits and sends values.
use crate::{
    dom::{Document, ElementData, NodeId, NodeKind},
    ipc::*,
    layout::LayoutTree,
};
use std::{collections::HashMap, error::Error};

pub fn collect(
    document: &Document,
    layout: &LayoutTree,
) -> Result<Vec<PaintControl>, Box<dyn Error>> {
    let mut forms = HashMap::new();
    let mut form_count = 0;
    for id in 0..document.len() as NodeId {
        if ancestors(document, id)
            .any(|p| element(document, p).is_some_and(|e| e.tag_name() == "template"))
        {
            continue;
        }
        if let Some(element) = element(document, id) {
            if element.tag_name() == "form" {
                form_count += 1;
                if form_count > MAX_CONTROLS {
                    return Err("too many forms".into());
                }
                if let Some(name) = element.attribute("id") {
                    forms.entry(name).or_insert(id);
                }
            }
        }
    }
    let mut controls = Vec::new();
    let mut bytes = 0;
    for id in 0..document.len() as NodeId {
        let Some(e) = element(document, id) else {
            continue;
        };
        if ancestors(document, id)
            .any(|p| element(document, p).is_some_and(|e| e.tag_name() == "template"))
        {
            continue;
        }
        if !matches!(e.tag_name(), "input" | "button" | "textarea" | "select") {
            continue;
        }
        if controls.len() == MAX_CONTROLS {
            return Err("too many form controls".into());
        }
        let form = if let Some(name) = e.attribute("form") {
            forms.get(name).copied()
        } else {
            ancestors(document, id)
                .find(|p| element(document, *p).is_some_and(|e| e.tag_name() == "form"))
        };
        let owner = form.and_then(|id| element(document, id));
        let ty = e
            .attribute("type")
            .unwrap_or(if e.tag_name() == "button" {
                "submit"
            } else {
                "text"
            })
            .to_ascii_lowercase();
        let kind = match e.tag_name() {
            "textarea" => FIELD_TEXT,
            "select" => FIELD_UNSUPPORTED,
            _ => match ty.as_str() {
                "text" | "search" | "email" | "url" | "tel" => FIELD_TEXT,
                "password" => FIELD_PASSWORD,
                "hidden" => FIELD_HIDDEN,
                "submit" => FIELD_SUBMIT,
                "checkbox" => FIELD_CHECKBOX,
                _ => FIELD_UNSUPPORTED,
            },
        };
        let mut flags = 0;
        if e.attribute("disabled").is_some()
            || ancestors(document, id).any(|p| {
                element(document, p).is_some_and(|e| {
                    e.tag_name() == "fieldset" && e.attribute("disabled").is_some()
                })
            })
        {
            flags |= DISABLED;
        }
        if e.attribute("readonly").is_some() {
            flags |= READ_ONLY;
        }
        if e.attribute("required").is_some() {
            flags |= REQUIRED;
        }
        if e.attribute("checked").is_some() {
            flags |= CHECKED;
        }
        let max_length = e
            .attribute("maxlength")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(MAX_FIELD_BYTES as u32)
            .min(MAX_FIELD_BYTES as u32);
        let value = if e.tag_name() == "textarea" {
            document.text_content(id)
        } else {
            e.attribute("value")
                .unwrap_or(if kind == FIELD_CHECKBOX { "on" } else { "" })
                .to_string()
        };
        let label = if e.tag_name() == "button" {
            document.text_content(id).trim().to_string()
        } else if kind == FIELD_SUBMIT {
            if value.is_empty() {
                "Submit".into()
            } else {
                value.clone()
            }
        } else {
            e.attribute("placeholder").unwrap_or("").to_string()
        };
        let action = if kind == FIELD_SUBMIT {
            e.attribute("formaction")
        } else {
            None
        }
        .or_else(|| owner.and_then(|f| f.attribute("action")))
        .unwrap_or("")
        .to_string();
        let mut method = if kind == FIELD_SUBMIT {
            e.attribute("formmethod")
        } else {
            None
        }
        .or_else(|| owner.and_then(|f| f.attribute("method")))
        .unwrap_or("get")
        .to_ascii_lowercase();
        if owner.is_some_and(|f| {
            f.attribute("enctype")
                .is_some_and(|v| !v.eq_ignore_ascii_case("application/x-www-form-urlencoded"))
        }) {
            method = "unsupported".into();
        }
        let name = e.attribute("name").unwrap_or("").to_string();
        for (value, limit) in [
            (&action, 8192),
            (&method, 16),
            (&name, 256),
            (&value, MAX_FIELD_BYTES),
            (&label, 1024),
        ] {
            if value.len() > limit {
                return Err("form field exceeded its byte limit".into());
            }
            bytes += value.len();
        }
        if bytes > MAX_CONTROL_BYTES {
            return Err("form descriptor budget exceeded".into());
        }
        let rect = layout
            .boxes
            .get(id as usize)
            .and_then(|b| *b)
            .map(|b| WireRect {
                x: b.rect.x,
                y: b.rect.y,
                width: b.rect.width,
                height: b.rect.height,
            })
            .unwrap_or_default();
        controls.push(PaintControl {
            rect,
            form: form.map_or(0, |id| id + 1),
            kind,
            flags,
            max_length,
            action,
            method,
            name,
            value,
            label,
        });
    }
    Ok(controls)
}
fn element(document: &Document, id: NodeId) -> Option<&ElementData> {
    match document.node(id)?.kind() {
        NodeKind::Element(e) => Some(e),
        _ => None,
    }
}
fn ancestors(document: &Document, id: NodeId) -> impl Iterator<Item = NodeId> + '_ {
    let mut next = document.node(id).and_then(|n| n.parent());
    std::iter::from_fn(move || {
        let current = next?;
        next = document.node(current).and_then(|n| n.parent());
        Some(current)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn collect_html(source: &str) -> Result<Vec<PaintControl>, Box<dyn Error>> {
        let document = crate::html::parse(source)?;
        let sheet = crate::css::Stylesheet::from_document(&document)?;
        let styles = crate::style::compute(&document, &sheet);
        let layout = crate::layout::build(&document, &styles, &Default::default(), 852)?;
        collect(&document, &layout)
    }
    #[test]
    fn template_controls_do_not_participate_in_submission() {
        let controls=collect_html("<form id=f><input name=q><template><input form=f name=hidden value=must-not-send></template></form>").unwrap();
        assert_eq!(controls.len(), 1);
        assert_eq!(controls[0].name, "q");
    }

    #[test]
    fn assigns_forms_and_supports_external_owner_and_button_overrides() {
        let controls = collect_html("<body><form id=s action=/search><input name=q placeholder='검색' required><input type=hidden name=t value=한글><fieldset disabled><input name=blocked></fieldset><button formaction=/other formmethod=post>보내기</button></form><input form=s name=outside><textarea form=s name=m>1 &lt; 3</textarea></body>").unwrap();
        assert_eq!(controls.len(), 6);
        assert!(controls.iter().all(|c| c.form == controls[0].form));
        assert!(controls[0].rect.width > 0);
        assert_eq!(controls[0].flags & REQUIRED, REQUIRED);
        assert_eq!(controls[1].kind, FIELD_HIDDEN);
        assert_eq!(controls[1].rect.width, 0);
        assert_eq!(controls[2].flags & DISABLED, DISABLED);
        assert_eq!(controls[3].action, "/other");
        assert_eq!(controls[3].method, "post");
        assert_eq!(controls[3].label, "보내기");
        assert_eq!(controls[5].value, "1 < 3");
    }
    #[test]
    fn controls_and_values_have_finite_limits() {
        assert!(collect_html(&format!(
            "<form>{}</form>",
            "<input>".repeat(MAX_CONTROLS + 1)
        ))
        .is_err());
        assert!(collect_html(&format!(
            "<input value='{}'>",
            "a".repeat(MAX_FIELD_BYTES + 1)
        ))
        .is_err());
    }
    #[test]
    fn css_hidden_fields_are_not_painted_and_unknown_owners_stay_unowned() {
        let controls = collect_html("<form id=f><div style='display:none'><input name=a value=b></div></form><input form=missing name=c>").unwrap();
        assert_eq!(controls[0].rect.width, 0);
        assert_ne!(controls[0].form, 0);
        assert_eq!(controls[1].form, 0);
    }
}
