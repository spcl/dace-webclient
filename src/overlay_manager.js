// Copyright 2019-2020 ETH Zurich and the DaCe authors. All rights reserved.

import { createElement } from "./utils/utils";
import { GenericSdfgOverlay } from './overlays/generic_sdfg_overlay';
import { RuntimeMicroSecondsOverlay } from './overlays/runtime_micro_seconds_overlay';
import { StaticFlopsOverlay } from './overlays/static_flops_overlay';
import { MemoryVolumeOverlay } from './overlays/memory_volume_overlay';
import { parse } from 'mathjs';
import { type } from 'jquery';

class SymbolResolver {

    constructor(renderer) {
        this.renderer = renderer;
        this.sdfg = this.renderer.sdfg;
        this.vscode = typeof vscode !== 'undefined' && vscode;

        // Initialize the symbol mapping to the graph's symbol table.
        this.symbol_value_map = {};
        Object.keys(this.sdfg.attributes.symbols).forEach((s) => {
            if (this.sdfg.attributes.constants_prop !== undefined &&
                Object.keys(this.sdfg.attributes.constants_prop).includes(s) &&
                this.sdfg.attributes.constants_prop[s][0]['type'] === 'Scalar')
                this.symbol_value_map[s] = this.sdfg.attributes.constants_prop[
                    s
                ][1];
            else
                this.symbol_value_map[s] = undefined;
        });
        this.symbols_to_define = [];

        this.init_overlay_popup_dialogue();
    }

    symbol_value_changed(symbol, value) {
        if (symbol in this.symbol_value_map)
            this.symbol_value_map[symbol] = value;
    }

    parse_symbol_expression(
        expression_string,
        mapping,
        prompt_completion = false,
        callback = undefined
    ) {
        let result = undefined;
        try {
            const expression_tree = parse(expression_string);
            if (prompt_completion) {
                this.recursive_find_undefined_symbol(expression_tree, mapping);
                this.prompt_define_symbol(mapping, callback);
            } else {
                try {
                    const evaluated =
                        expression_tree.evaluate(mapping);
                    if (evaluated !== undefined &&
                        !isNaN(evaluated) &&
                        Number.isInteger(+evaluated))
                        result = +evaluated;
                    else
                        result = undefined;
                } catch (e) {
                    result = undefined;
                }
            }
            return result;
        } catch (exception) {
            console.error(exception);
        } finally {
            return result;
        }
    }

    prompt_define_symbol(mapping, callback = undefined) {
        if (this.symbols_to_define.length > 0) {
            const symbol = this.symbols_to_define.pop();
            const that = this;
            this.popup_dialogue._show(
                symbol,
                mapping,
                () => {
                    if (this.vscode)
                        vscode.postMessage({
                            type: 'analysis.define_symbol',
                            symbol: symbol,
                            definition: mapping[symbol],
                        });
                    if (callback !== undefined)
                        callback();
                    that.prompt_define_symbol(mapping, callback);
                }
            );
        }
    }

    recursive_find_undefined_symbol(expression_tree, mapping) {
        expression_tree.forEach((node, path, parent) => {
            switch (node.type) {
                case 'SymbolNode':
                    if (node.name in mapping &&
                        mapping[node.name] === undefined &&
                        !this.symbols_to_define.includes(node.name)) {
                        // This is an undefined symbol.
                        // Ask for it to be defined.
                        this.symbols_to_define.push(node.name);
                    }
                    break;
                case 'OperatorNode':
                case 'ParenthesisNode':
                    this.recursive_find_undefined_symbol(node, mapping);
                    break;
                default:
                    // Ignore
                    break;
            }
        });
    }

    init_overlay_popup_dialogue() {
        const dialogue_background = createElement('div', '', ['modal_background'],
            document.body);
        dialogue_background._show = function () {
            this.style.display = 'block';
        };
        dialogue_background._hide = function () {
            this.style.display = 'none';
        };

        const popup_dialogue = createElement('div', 'sdfv_overlay_dialogue',
            ['modal'], dialogue_background);
        popup_dialogue.addEventListener('click', (ev) => {
            ev.stopPropagation();
        });
        popup_dialogue.style.display = 'none';
        this.popup_dialogue = popup_dialogue;

        const header_bar = createElement('div', '', ['modal_title_bar'],
            this.popup_dialogue);
        this.popup_dialogue._title = createElement('span', '', ['modal_title'],
            header_bar);
        const close_button = createElement('div', '', ['modal_close'],
            header_bar);
        close_button.innerHTML = '<i class="material-icons">close</i>';
        close_button.addEventListener('click', () => {
            popup_dialogue._hide();
        });

        const content_box = createElement('div', '', ['modal_content_box'],
            this.popup_dialogue);
        this.popup_dialogue._content = createElement('div', '',
            ['modal_content'], content_box);
        this.popup_dialogue._input = createElement('input', 'symbol_input',
            ['modal_input_text'], this.popup_dialogue._content);

        function set_val() {
            if (popup_dialogue._map && popup_dialogue._symbol) {
                const val = popup_dialogue._input.value;
                if (val && !isNaN(val) && Number.isInteger(+val) && val > 0) {
                    popup_dialogue._map[popup_dialogue._symbol] = val;
                    popup_dialogue._hide();
                    if (popup_dialogue._callback)
                        popup_dialogue._callback();
                    return;
                }
            }
            popup_dialogue._input.setCustomValidity('Invalid, not an integer');
        }
        this.popup_dialogue._input.addEventListener('keypress', (ev) => {
            if (ev.which === 13)
                set_val();
        });

        const footer_bar = createElement('div', '', ['modal_footer_bar'],
            this.popup_dialogue);
        const confirm_button = createElement('div', '',
            ['button', 'modal_confirm_button'], footer_bar);
        confirm_button.addEventListener('click', (ev) => { set_val(); });
        const confirm_button_text = createElement('span', '', [], confirm_button);
        confirm_button_text.innerText = 'Confirm';
        createElement('div', '', ['clearfix'], footer_bar);

        this.popup_dialogue._show = function (symbol, map, callback) {
            this.style.display = 'block';
            popup_dialogue._title.innerText = 'Define symbol ' + symbol;
            popup_dialogue._symbol = symbol;
            popup_dialogue._map = map;
            popup_dialogue._callback = callback;
            dialogue_background._show();
        };
        this.popup_dialogue._hide = function () {
            this.style.display = 'none';
            popup_dialogue._title.innerText = '';
            popup_dialogue._input.value = '';
            popup_dialogue._input.setCustomValidity('');
            dialogue_background._hide();
        };
        dialogue_background.addEventListener('click', (ev) => {
            popup_dialogue._hide();
        });
    }

}

export class OverlayManager {

    constructor(renderer) {
        this.renderer = renderer;

        this.memory_volume_overlay_active = false;
        this.static_flops_overlay_active = false;
        this.runtime_us_overlay_active = false;
        this.badness_scale_method = 'median';

        this.overlays = [];

        this.symbol_resolver = new SymbolResolver(this.renderer);
    }

    register_overlay(type) {
        switch (type) {
            case GenericSdfgOverlay.OVERLAY_TYPE.MEMORY_VOLUME:
                this.overlays.push(
                    new MemoryVolumeOverlay(this, this.renderer)
                );
                this.memory_volume_overlay_active = true;
                break;
            case GenericSdfgOverlay.OVERLAY_TYPE.STATIC_FLOPS:
                this.overlays.push(
                    new StaticFlopsOverlay(this, this.renderer)
                );
                this.static_flops_overlay_active = true;
                break;
            case GenericSdfgOverlay.OVERLAY_TYPE.RUNTIME_US:
                this.overlays.push(
                    new RuntimeMicroSecondsOverlay(this, this.renderer)
                );
                this.runtime_us_overlay_active = true;
                break;
            default:
                break;
        }
        this.renderer.draw_async();
    }

    deregister_overlay(type) {
        this.overlays = this.overlays.filter(overlay => {
            return overlay.type !== type;
        });

        switch (type) {
            case GenericSdfgOverlay.OVERLAY_TYPE.MEMORY_VOLUME:
                this.memory_volume_overlay_active = false;
                break;
            case GenericSdfgOverlay.OVERLAY_TYPE.STATIC_FLOPS:
                this.static_flops_overlay_active = false;
                break;
            case GenericSdfgOverlay.OVERLAY_TYPE.RUNTIME_US:
                this.runtime_us_overlay_active = false;
                break;
            default:
                break;
        }
        this.renderer.draw_async();
    }

    get_overlay(type) {
        let overlay = undefined;
        this.overlays.forEach(ol => {
            if (ol.type === type) {
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
