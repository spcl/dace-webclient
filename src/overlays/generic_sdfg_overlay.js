
export class GenericSdfgOverlay {

    constructor(overlay_manager, renderer) {
        this.overlay_manager = overlay_manager;
        this.symbol_resolver = this.overlay_manager.symbol_resolver;
        this.renderer = renderer;
        this.vscode = typeof vscode !== 'undefined' && vscode;

        this.badness_scale_center = 5;
    }

    draw() {
    }

    on_mouse_event(type, ev, mousepos, elements, foreground_elem, ends_drag) {
        return false;
    }

    refresh() {
    }

}
