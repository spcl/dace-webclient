// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

import { createElement } from "./utils/utils";
import { RuntimeMicroSecondsOverlay } from './overlays/runtime_micro_seconds_overlay';
import { StaticFlopsOverlay } from './overlays/static_flops_overlay';
import { MemoryVolumeOverlay } from './overlays/memory_volume_overlay';
import { parse } from 'mathjs';
import { htmlSanitize } from "./utils/sanitization";

export class SymbolResolver {

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
        let dialogue_background = createElement('div', '',
            ['sdfv_modal_background'], document.body);
        dialogue_background._show = function () {
            this.style.display = 'block';
        };
        dialogue_background._hide = function () {
            this.style.display = 'none';
        };

        let popup_dialogue = createElement('div', 'sdfv_overlay_dialogue',
            ['sdfv_modal'], dialogue_background);
        popup_dialogue.addEventListener('click', (ev) => {
            ev.stopPropagation();
        });
        popup_dialogue.style.display = 'none';
        this.popup_dialogue = popup_dialogue;

        let header_bar = createElement('div', '', ['sdfv_modal_title_bar'],
            this.popup_dialogue);
        this.popup_dialogue._title = createElement('span', '',
            ['sdfv_modal_title'], header_bar);
        let close_button = createElement('div', '', ['modal_close'],
            header_bar);
        close_button.innerHTML = htmlSanitize`<i class="material-icons">close</i>`;
        close_button.addEventListener('click', () => {
            popup_dialogue._hide();
        });

        let content_box = createElement('div', '', ['sdfv_modal_content_box'],
            this.popup_dialogue);
        this.popup_dialogue._content = createElement('div', '',
            ['sdfv_modal_content'], content_box);
        this.popup_dialogue._input = createElement('input', 'symbol_input',
            ['sdfv_modal_input_text'], this.popup_dialogue._content);
        
        function set_val() {
            if (popup_dialogue._map && popup_dialogue._symbol) {
                let val = popup_dialogue._input.value;
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

        let footer_bar = createElement('div', '', ['sdfv_modal_footer_bar'],
            this.popup_dialogue);
        let confirm_button = createElement('div', '',
            ['button', 'sdfv_modal_confirm_button'], footer_bar);
        confirm_button.addEventListener('click', (ev) => { set_val(); });
        let confirm_button_text = createElement('span', '', [], confirm_button);
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
