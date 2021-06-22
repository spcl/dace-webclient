
export class GenericSdfgOverlay {

    constructor(overlay_manager, renderer, type) {
        this.overlay_manager = overlay_manager;
        this.symbol_resolver = this.overlay_manager.symbol_resolver;
        this.renderer = renderer;
        this.type = type;
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

GenericSdfgOverlay.OVERLAY_TYPE = {
    MEMORY_VOLUME: 'OVERLAY_TYPE_MEMORY_VOLUME',
    STATIC_FLOPS: 'OVERLAY_TYPE_STATIC_FLOPS',
    RUNTIME_US: 'OVERLAY_TYPE_RUNTIME_US',
    CONSTRUCTION: 'OVERLAY_TYPE_UNDER_CONSTRUCTION',
};
