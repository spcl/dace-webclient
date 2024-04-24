// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import { MathNode, parse, SymbolNode } from 'mathjs';
import { Point2D, SymbolMap } from './index';
import { GenericSdfgOverlay } from './overlays/generic_sdfg_overlay';
import { SDFGRenderer } from './renderer/renderer';
import { SDFGElement } from './renderer/renderer_elements';
import { createElement } from './utils/utils';

export class SymbolResolver {

    private sdfg: any;
    private symbol_value_map: SymbolMap = {};
    private symbols_to_define: string[] = [];
    private popup_dialogue: any = undefined;

    public constructor(
        private readonly renderer: SDFGRenderer
    ) {
        this.sdfg = this.renderer.get_sdfg();

        // Initialize the symbol mapping to the graph's symbol table.
        Object.keys(this.sdfg.attributes.symbols ?? []).forEach((s) => {
            if (this.sdfg.attributes.constants_prop !== undefined &&
                Object.keys(this.sdfg.attributes.constants_prop).includes(s) &&
                this.sdfg.attributes.constants_prop[s][0]['type'] ===
                    'Scalar') {
                this.symbol_value_map[s] = this.sdfg.attributes.constants_prop[
                    s
                ][1];
            } else {
                this.symbol_value_map[s] = undefined;
            }
        });

        this.init_overlay_popup_dialogue();
    }

    public removeStaleSymbols(): void {
        const toKeep: SymbolMap = {};
        for (const sym in this.renderer.get_sdfg().attributes.symbols ?? [])
            toKeep[sym] = this.symbol_value_map[sym];
        this.symbol_value_map = toKeep;
    }

    public symbol_value_changed(
        symbol: string, value: number | undefined
    ): void {
        if (symbol in this.symbol_value_map)
            this.symbol_value_map[symbol] = value;
    }

    public parse_symbol_expression(
        expression_string: string,
        mapping: SymbolMap,
        prompt_completion: boolean = false,
        callback: CallableFunction | undefined = undefined
    ): number | undefined {
        let result: number | undefined = undefined;
        try {
            // Ensure any expressions with the sympy symbol for 'power of' (**)
            // is cleaned by replacing with the symbol '^', which is parseable
            // by mathjs.
            const pow_cleaned = expression_string.replaceAll('**', '^');

            const expression_tree = parse(pow_cleaned);
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
            return result;
        }
    }

    public prompt_define_symbol(
        mapping: SymbolMap, callback: CallableFunction | undefined = undefined
    ): void {
        if (this.symbols_to_define.length > 0) {
            const symbol = this.symbols_to_define.pop();
            if (symbol === undefined)
                return;
            this.popup_dialogue._show(
                symbol,
                mapping,
                () => {
                    this.renderer.emit(
                        'symbol_definition_changed', symbol, mapping[symbol]
                    );
                    if (callback !== undefined)
                        callback();
                    this.prompt_define_symbol(mapping, callback);
                }
            );
        }
    }

    public recursive_find_undefined_symbol(
        expression_tree: MathNode, mapping: SymbolMap
    ): void {
        expression_tree.forEach((
            node: MathNode, _path: string, _parent: MathNode
        ) => {
            switch (node.type) {
                case 'SymbolNode':
                    {
                        const symnode = node as SymbolNode;
                        if (symnode.name && symnode.name in mapping &&
                            mapping[symnode.name] === undefined &&
                            !this.symbols_to_define.includes(symnode.name)) {
                            // This is an undefined symbol.
                            // Ask for it to be defined.
                            this.symbols_to_define.push(symnode.name);
                        }
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

    public init_overlay_popup_dialogue(): void {
        const dialogue_background: any = createElement(
            'div', '', ['sdfv_modal_background'], document.body
        );
        dialogue_background._show = function () {
            this.style.display = 'block';
        };
        dialogue_background._hide = function () {
            this.style.display = 'none';
        };

        const popup_dialogue: any = createElement(
            'div', 'sdfv_overlay_dialogue', ['sdfv_modal'], dialogue_background
        );
        popup_dialogue.addEventListener('click', (ev: Event) => {
            ev.stopPropagation();
        });
        popup_dialogue.style.display = 'none';
        this.popup_dialogue = popup_dialogue;

        const header_bar = createElement(
            'div', '', ['sdfv_modal_title_bar'], this.popup_dialogue
        );
        this.popup_dialogue._title = createElement(
            'span', '', ['sdfv_modal_title'], header_bar
        );
        const close_button = createElement(
            'div', '', ['modal_close'], header_bar
        );
        close_button.innerHTML = '<i class="material-icons">close</i>';
        close_button.addEventListener('click', () => {
            popup_dialogue._hide();
        });

        const content_box = createElement(
            'div', '', ['sdfv_modal_content_box'], this.popup_dialogue
        );
        this.popup_dialogue._content = createElement(
            'div', '', ['sdfv_modal_content'], content_box
        );
        this.popup_dialogue._input = createElement(
            'input', 'symbol_input', ['sdfv_modal_input_text'],
            this.popup_dialogue._content
        );

        function set_val(): void {
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
        this.popup_dialogue._input.addEventListener(
            'keypress', (ev: KeyboardEvent) => {
                if (ev.code === 'Enter')
                    set_val();
            }
        );

        const footer_bar = createElement(
            'div', '', ['sdfv_modal_footer_bar'], this.popup_dialogue
        );
        const confirm_button = createElement(
            'div', '', ['button', 'sdfv_modal_confirm_button'], footer_bar
        );
        confirm_button.addEventListener('click', (_ev: MouseEvent) => {
            set_val();
        });
        const confirm_button_text = createElement(
            'span', '', [], confirm_button
        );
        confirm_button_text.innerText = 'Confirm';
        createElement('div', '', ['clearfix'], footer_bar);

        this.popup_dialogue._show = function (
            symbol: string, map: SymbolMap, callback: CallableFunction
        ) {
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
        dialogue_background.addEventListener('click', (_ev: MouseEvent) => {
            popup_dialogue._hide();
        });
    }

    public get_symbol_value_map(): SymbolMap {
        return this.symbol_value_map;
    }

}

export class OverlayManager {

    private heatmap_scaling_method: string = 'median';
    private heatmap_scaling_hist_n_buckets: number = 0;
    private heatmap_scaling_exp_base: number = 2;
    private overlays: GenericSdfgOverlay[] = [];
    private symbol_resolver: SymbolResolver;

    public constructor(private readonly renderer: SDFGRenderer) {
        this.symbol_resolver = new SymbolResolver(this.renderer);
    }

    public register_overlay(type: typeof GenericSdfgOverlay): void {
        this.overlays.push(new type(this.renderer));
        this.renderer.draw_async();
    }

    public deregister_overlay(type: typeof GenericSdfgOverlay): void {
        this.overlays = this.overlays.filter(overlay => {
            return !(overlay instanceof type);
        });
        this.renderer.draw_async();
    }

    public deregisterAll(except?: (typeof GenericSdfgOverlay)[]): void {
        for (const ol of this.overlays) {
            // Do not deregister the overlays given in the "except" list.
            if (except && except.includes(ol.olClass))
                continue;
            this.deregister_overlay(ol.olClass);
        }
    }

    public is_overlay_active(type: typeof GenericSdfgOverlay): boolean {
        return this.overlays.filter(overlay => {
            return overlay instanceof type;
        }).length > 0;
    }

    public get_overlay(
        type: typeof GenericSdfgOverlay
    ): GenericSdfgOverlay | undefined {
        let overlay = undefined;
        this.overlays.forEach(ol => {
            if (ol instanceof type) {
                overlay = ol;
                return;
            }
        });
        return overlay;
    }

    public on_symbol_value_changed(
        symbol: string, value: number | undefined
    ): void {
        this.symbol_resolver.symbol_value_changed(symbol, value);
        this.overlays.forEach(overlay => {
            overlay.refresh();
        });
    }

    public update_heatmap_scaling_method(method: string): void {
        this.heatmap_scaling_method = method;
        this.overlays.forEach(overlay => {
            overlay.refresh();
        });
    }

    public update_heatmap_scaling_hist_n_buckets(n: number): void {
        this.heatmap_scaling_hist_n_buckets = n;
        this.overlays.forEach(overlay => {
            overlay.refresh();
        });
    }

    public update_heatmap_scaling_exp_base(base: number): void {
        this.heatmap_scaling_exp_base = base;
        this.overlays.forEach(overlay => {
            overlay.refresh();
        });
    }

    public draw(): void {
        this.overlays.forEach(overlay => {
            overlay.draw();
        });
    }

    public refresh(): void {
        this.overlays.forEach(overlay => {
            overlay.refresh();
        });
    }

    public on_mouse_event(
        type: string,
        ev: MouseEvent,
        mousepos: Point2D,
        elements: SDFGElement[],
        foreground_elem: SDFGElement | undefined,
        ends_drag: boolean
    ): boolean {
        let dirty = false;
        this.overlays.forEach(overlay => {
            dirty = dirty || overlay.on_mouse_event(
                type, ev, mousepos, elements,
                foreground_elem, ends_drag
            );
        });
        return dirty;
    }

    public get_heatmap_scaling_hist_n_buckets(): number {
        return this.heatmap_scaling_hist_n_buckets;
    }

    public get_heatmap_scaling_exp_base(): number {
        return this.heatmap_scaling_exp_base;
    }

    public get_heatmap_scaling_method(): string {
        return this.heatmap_scaling_method;
    }

    public get_symbol_resolver(): SymbolResolver {
        return this.symbol_resolver;
    }

    public get_overlays(): GenericSdfgOverlay[] {
        return this.overlays;
    }

}
