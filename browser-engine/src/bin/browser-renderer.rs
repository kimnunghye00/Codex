#[path = "../css.rs"]
mod css;
#[path = "../dom.rs"]
mod dom;
#[path = "../html.rs"]
mod html;
#[path = "../ipc.rs"]
mod ipc;
#[path = "../layout.rs"]
mod layout;
#[path = "../renderer_worker.rs"]
mod renderer_worker;
#[path = "../resource_limits.rs"]
mod resource_limits;
#[path = "../resources.rs"]
mod resources;
#[path = "../style.rs"]
mod style;

use std::error::Error;

fn main() -> Result<(), Box<dyn Error>> {
    renderer_worker::run()
}
