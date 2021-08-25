// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

import { GenericSdfgOverlay } from './overlays/generic_sdfg_overlay';
import { RuntimeMicroSecondsOverlay } from './overlays/runtime_micro_seconds_overlay';
import { StaticFlopsOverlay } from './overlays/static_flops_overlay';
import { MemoryVolumeOverlay } from './overlays/memory_volume_overlay';
import { SymbolResolver } from "./utils/symbol_resolver";

export class OverlayManager {

    constructor(renderer) {
        this.renderer = renderer;

        this.badness_scale_method = 'median';

        this.overlays = [];

        this.symbol_resolver = new SymbolResolver(this.renderer);
    }

    register_overlay(type) {
        switch (type) {
            case MemoryVolumeOverlay:
            case StaticFlopsOverlay:
            case RuntimeMicroSecondsOverlay:
                this.overlays.push(
                    new type(this, this.renderer)
                );
                break;
            default:
                // Object overlay
                this.overlays.push(type);
                break;
        }
        this.renderer.draw_async();
    }

    deregister_overlay(type) {
        this.overlays = this.overlays.filter(overlay => {
            return !(overlay instanceof type);
        });

        this.renderer.draw_async();
    }

    is_overlay_active(type) {
        return this.overlays.filter(overlay => {
            return overlay instanceof type;
        }).length > 0;
    }

    get_overlay(type) {
        let overlay = undefined;
        this.overlays.forEach(ol => {
            if (ol instanceof type) {
                overlay = ol;
                return;
            }
        });
        return overlay;
    }

    symbol_value_changed(symbol, value) {
        this.symbol_resolver.symbol_value_changed(symbol, value);
        this.overlays.forEach(overlay => {
            overlay.refresh();
        });
    }

    update_badness_scale_method(method) {
        this.badness_scale_method = method;
        this.overlays.forEach(overlay => {
            overlay.refresh();
        });
    }

    draw() {
        this.overlays.forEach(overlay => {
            overlay.draw();
        });
    }

    refresh() {
        this.overlays.forEach(overlay => {
            overlay.refresh();
        });
    }

    on_mouse_event(type, ev, mousepos, elements, foreground_elem, ends_drag) {
        this.overlays.forEach(overlay => {
            overlay.on_mouse_event(type, ev, mousepos, elements,
                foreground_elem, ends_drag);
        });
    }

}
