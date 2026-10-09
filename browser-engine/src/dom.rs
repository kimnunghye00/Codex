use std::fmt;

pub type NodeId = u32;
const NONE: NodeId = NodeId::MAX;

#[derive(Debug)]
pub struct Document {
    nodes: Vec<Node>,
}

#[derive(Debug)]
pub struct Node {
    parent: NodeId,
    first_child: NodeId,
    last_child: NodeId,
    next_sibling: NodeId,
    kind: NodeKind,
}

#[derive(Debug)]
pub enum NodeKind {
    Document,
    Element(ElementData),
    Text(Box<str>),
}

#[derive(Debug)]
pub struct ElementData {
    tag_name: Box<str>,
    attributes: Vec<Attribute>,
}

#[derive(Debug)]
pub struct Attribute {
    name: Box<str>,
    value: Box<str>,
}

impl Document {
    pub fn new() -> Self {
        Self {
            nodes: vec![Node {
                parent: NONE,
                first_child: NONE,
                last_child: NONE,
                next_sibling: NONE,
                kind: NodeKind::Document,
            }],
        }
    }

    pub fn root(&self) -> NodeId {
        0
    }

    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn node(&self, id: NodeId) -> Option<&Node> {
        self.nodes.get(id as usize)
    }

    pub fn children(&self, id: NodeId) -> Children<'_> {
        let next = self.first_child(id).unwrap_or(NONE);
        Children {
            document: self,
            next,
        }
    }

    pub fn first_child(&self, id: NodeId) -> Option<NodeId> {
        let child = self.node(id)?.first_child;
        (child != NONE).then_some(child)
    }

    pub fn next_sibling(&self, id: NodeId) -> Option<NodeId> {
        let sibling = self.node(id)?.next_sibling;
        (sibling != NONE).then_some(sibling)
    }

    pub(crate) fn append(&mut self, parent: NodeId, kind: NodeKind) -> NodeId {
        let id = self.nodes.len() as NodeId;
        self.nodes.push(Node {
            parent,
            first_child: NONE,
            last_child: NONE,
            next_sibling: NONE,
            kind,
        });

        let last_child = self.nodes[parent as usize].last_child;
        if last_child == NONE {
            self.nodes[parent as usize].first_child = id;
        } else {
            self.nodes[last_child as usize].next_sibling = id;
        }
        self.nodes[parent as usize].last_child = id;

        id
    }

    pub fn find_first_element(&self, tag_name: &str) -> Option<NodeId> {
        self.nodes.iter().enumerate().find_map(|(index, node)| {
            let NodeKind::Element(element) = &node.kind else {
                return None;
            };

            element
                .tag_name
                .eq_ignore_ascii_case(tag_name)
                .then_some(index as NodeId)
        })
    }

    pub fn text_content(&self, start: NodeId) -> String {
        let mut output = String::new();
        let mut stack = Vec::with_capacity(16);

        if let Some(child) = self.first_child(start) {
            stack.push(child);
        }

        while let Some(id) = stack.pop() {
            if let Some(node) = self.node(id) {
                if let NodeKind::Text(text) = node.kind() {
                    output.push_str(text);
                }
            }

            if let Some(sibling) = self.next_sibling(id) {
                stack.push(sibling);
            }
            if let Some(child) = self.first_child(id) {
                stack.push(child);
            }
        }

        output
    }

    pub fn visible_text(&self) -> String {
        let start = self.find_first_element("body").unwrap_or(self.root());
        let mut output = String::new();
        let mut ancestors = Vec::with_capacity(32);

        let Some(mut current) = self.first_child(start) else {
            return output;
        };

        loop {
            let skip_children = self.enter_visible_node(current, &mut output);

            if !skip_children {
                if let Some(child) = self.first_child(current) {
                    ancestors.push(current);
                    current = child;
                    continue;
                }
            }

            self.leave_visible_node(current, &mut output);

            loop {
                if let Some(sibling) = self.next_sibling(current) {
                    current = sibling;
                    break;
                }

                let Some(parent) = ancestors.pop() else {
                    return normalize_rendered_text(&output);
                };

                self.leave_visible_node(parent, &mut output);
                current = parent;
            }
        }
    }

    fn enter_visible_node(&self, id: NodeId, output: &mut String) -> bool {
        match &self.nodes[id as usize].kind {
            NodeKind::Text(text) => {
                push_collapsed_text(output, text);
                false
            }
            NodeKind::Element(element) => {
                if is_hidden_tag(element.tag_name()) {
                    return true;
                }

                if is_block_tag(element.tag_name()) {
                    push_newline(output);
                }
                false
            }
            NodeKind::Document => false,
        }
    }

    fn leave_visible_node(&self, id: NodeId, output: &mut String) {
        if let NodeKind::Element(element) = &self.nodes[id as usize].kind {
            if !is_hidden_tag(element.tag_name()) && is_block_tag(element.tag_name()) {
                push_newline(output);
            }
        }
    }
}

impl Default for Document {
    fn default() -> Self {
        Self::new()
    }
}

impl Node {
    pub fn kind(&self) -> &NodeKind {
        &self.kind
    }

    pub fn parent(&self) -> Option<NodeId> {
        (self.parent != NONE).then_some(self.parent)
    }
}

impl ElementData {
    pub fn new(tag_name: String, attributes: Vec<Attribute>) -> Self {
        Self {
            tag_name: tag_name.into_boxed_str(),
            attributes,
        }
    }

    pub fn tag_name(&self) -> &str {
        &self.tag_name
    }

    pub fn attributes(&self) -> &[Attribute] {
        &self.attributes
    }

    pub fn attribute(&self, name: &str) -> Option<&str> {
        self.attributes
            .iter()
            .find(|attribute| attribute.name.eq_ignore_ascii_case(name))
            .map(|attribute| attribute.value.as_ref())
    }

    pub fn has_class(&self, class_name: &str) -> bool {
        self.attribute("class")
            .map(|classes| {
                classes
                    .split_ascii_whitespace()
                    .any(|value| value == class_name)
            })
            .unwrap_or(false)
    }
}

impl Attribute {
    pub fn new(name: String, value: String) -> Self {
        Self {
            name: name.into_boxed_str(),
            value: value.into_boxed_str(),
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn value(&self) -> &str {
        &self.value
    }
}

impl fmt::Display for NodeKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            NodeKind::Document => write!(formatter, "#document"),
            NodeKind::Element(element) => write!(formatter, "<{}>", element.tag_name),
            NodeKind::Text(text) => write!(formatter, "{text:?}"),
        }
    }
}

pub struct Children<'a> {
    document: &'a Document,
    next: NodeId,
}

impl<'a> Iterator for Children<'a> {
    type Item = NodeId;

    fn next(&mut self) -> Option<Self::Item> {
        if self.next == NONE {
            return None;
        }

        let current = self.next;
        self.next = self.document.nodes[current as usize].next_sibling;
        Some(current)
    }
}

fn is_hidden_tag(tag: &str) -> bool {
    matches!(tag, "script" | "style" | "template" | "head")
}

fn is_block_tag(tag: &str) -> bool {
    matches!(
        tag,
        "br" | "p"
            | "div"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "li"
            | "ul"
            | "ol"
            | "main"
            | "section"
            | "article"
            | "header"
            | "footer"
            | "nav"
            | "tr"
            | "table"
            | "blockquote"
            | "pre"
    )
}

fn push_newline(output: &mut String) {
    while output.ends_with(' ') {
        output.pop();
    }
    if !output.is_empty() && !output.ends_with('\n') {
        output.push('\n');
    }
}

fn push_collapsed_text(output: &mut String, text: &str) {
    let mut previous_space = output
        .chars()
        .last()
        .map(|ch| ch.is_whitespace())
        .unwrap_or(false);

    for ch in text.chars() {
        if ch.is_whitespace() {
            if !previous_space && !output.ends_with('\n') {
                output.push(' ');
            }
            previous_space = true;
        } else {
            output.push(ch);
            previous_space = false;
        }
    }
}

fn normalize_rendered_text(input: &str) -> String {
    let mut result = String::new();

    for line in input.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if !result.is_empty() {
            result.push('\n');
        }
        result.push_str(trimmed);
    }

    result
}
