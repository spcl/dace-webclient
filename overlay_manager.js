// Copyright 2019-2020 ETH Zurich and the DaCe authors. All rights reserved.

class SymbolResolver {

    constructor() {
        // Initialize an empty symbol - value mapping.
        this.symbol_value_map = {};
        this.symbols_to_define = [];

        this.init_overlay_popup_dialogue();
    }

    reset() {
        this.symbol_value_map = {};
        this.symbols_to_define = [];
    }

    parse_symbol_expression(expression_string, prompt_completion=false,
        callback=undefined) {
        let result = undefined;
        try {
            let expression_tree = math.parse(expression_string);
            if (prompt_completion) {
                this.recursive_find_undefined_symbol(expression_tree);
                this.prompt_define_symbol(callback);
            } else {
                try {
                    let evaluated =
                        expression_tree.evaluate(this.symbol_value_map);
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

    prompt_define_symbol(callback=undefined) {
        if (this.symbols_to_define.length > 0) {
            let symbol = this.symbols_to_define.pop();
            let that = this;
            this.popup_dialogue._show(
                symbol,
                this.symbol_value_map,
                () => {
                    if (callback !== undefined)
                        callback();
                    that.prompt_define_symbol(callback);
                }
            );
        }
    }

    recursive_find_undefined_symbol(expression_tree) {
        expression_tree.forEach((node, path, parent) => {
            switch (node.type) {
                case 'SymbolNode':
                    if (!this.symbol_value_map[node.name] &&
                        !this.symbols_to_define.includes(node.name)) {
                        // This is an undefined symbol.
                        // Ask for it to be defined.
                        this.symbols_to_define.push(node.name);
                    }
                    break;
                case 'OperatorNode':
                case 'ParenthesisNode':
                    this.recursive_find_undefined_symbol(node);
                    break;
                default:
                    // Ignore
                    break;
            }
        });
    }

    init_overlay_popup_dialogue() {
        let dialogue_background = createElement('div', '', ['modal_background'],
            document.body);
        dialogue_background._show = function () {
            this.style.display = 'block';
        };
        dialogue_background._hide = function () {
            this.style.display = 'none';
        };

        let popup_dialogue = createElement('div', 'sdfv_overlay_dialogue',
            ['modal'], dialogue_background);
        popup_dialogue.addEventListener('click', (ev) => {
            ev.stopPropagation();
        });
        popup_dialogue.style.display = 'none';
        this.popup_dialogue = popup_dialogue;

        let header_bar = createElement('div', '', ['modal_title_bar'],
            this.popup_dialogue);
        this.popup_dialogue._title = createElement('span', '', ['modal_title'],
            header_bar);
        let close_button = createElement('div', '', ['modal_close'],
            header_bar);
        close_button.innerHTML = '<i class="material-icons">close</i>';
        close_button.addEventListener('click', () => {
            popup_dialogue._hide();
        });

        let content_box = createElement('div', '', ['modal_content_box'],
            this.popup_dialogue);
        this.popup_dialogue._content = createElement('div', '',
            ['modal_content'], content_box);
        this.popup_dialogue._input = createElement('input', 'symbol_input',
            ['modal_input_text'], this.popup_dialogue._content);
        
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

        let footer_bar = createElement('div', '', ['modal_footer_bar'],
            this.popup_dialogue);
        let confirm_button = createElement('div', '',
            ['button', 'modal_confirm_button'], footer_bar);
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

class GenericSdfgOverlay {

    static OVERLAY_TYPE = {
        MEMORY_VOLUME: 'OVERLAY_TYPE_MEMORY_VOLUME',
        STATIC_FLOPS: 'OVERLAY_TYPE_STATIC_FLOPS',
    };

    constructor(overlay_manager, renderer, type) {
        this.overlay_manager = overlay_manager;
        this.symbol_resolver = this.overlay_manager.symbol_resolver;
        this.renderer = renderer;
        this.type = type;
    }

    draw() {
    }

    on_mouse_event(type, ev, mousepos, elements, foreground_elem, ends_drag) {
        return false;
    }

}

class StaticFlopsOverlay extends GenericSdfgOverlay {

    constructor(overlay_manager, renderer) {
        super(
            overlay_manager,
            renderer,
            GenericSdfgOverlay.OVERLAY_TYPE.STATIC_FLOPS
        );

        this.cutoff_high_flops = 10;
        this.highest_observed_flops = 0;

        this.flops_map = {};

        if (vscode) {
            vscode.postMessage({
                type: 'getFlops',
            });
        }
    }

    get_element_uuid(element) {
        let undefined_val = -1;
        if (element instanceof State) {
            return (
                element.sdfg.sdfg_list_id + '/' +
                element.id + '/' +
                undefined_val + '/' +
                undefined_val
            );
        } else if (element instanceof NestedSDFG) {
            let sdfg_id = element.data.node.attributes.sdfg.sdfg_list_id;
            return (
                sdfg_id + '/' +
                undefined_val + '/' +
                undefined_val + '/' +
                undefined_val
            );
        } else if (element instanceof MapExit) {
            // For MapExit nodes, we want to get the uuid of the corresponding
            // entry node instead, because the FLOPS count is held there.
            return (
                element.sdfg.sdfg_list_id + '/' +
                element.parent_id + '/' +
                element.data.node.scope_entry + '/' +
                undefined_val
            );
        } else if (element instanceof Node) {
            return (
                element.sdfg.sdfg_list_id + '/' +
                element.parent_id + '/' +
                element.id + '/' +
                undefined_val
            );
        }
        return (
            undefined_val + '/' +
            undefined_val + '/' +
            undefined_val + '/' +
            undefined_val
        );
    }

    clear_cached_flops_values() {
        this.renderer.for_all_elements(0, 0, 0, 0, (type, e, obj, isected) => {
            if (obj.data) {
                if (obj.data.flops !== undefined)
                    obj.data.flops = undefined;
                if (obj.data.flops_string !== undefined)
                    obj.data.flops_string = undefined;
            }
        });
    }

    calculate_flops_node(node) {
        let flops_string = this.flops_map[this.get_element_uuid(node)];
        let flops = undefined;
        if (flops_string !== undefined)
            flops = this.symbol_resolver.parse_symbol_expression(flops_string);

        node.data.flops_string = flops_string;
        node.data.flops = flops;

        if (flops > this.highest_observed_flops)
            this.highest_observed_flops = flops;

        return flops;
    }
    
    calculate_flops_graph(g) {
        let that = this;
        g.nodes().forEach(v => {
            let state = g.node(v);
            that.calculate_flops_node(state);
            let state_graph = state.data.graph;
            if (state_graph) {
                state_graph.nodes().forEach(v => {
                    let node = state_graph.node(v);
                    that.calculate_flops_node(node);
                    if (node instanceof NestedSDFG)
                        that.calculate_flops_graph(node.data.graph);
                });
            }
        });
    }

    recalculate_flops_values(graph) {
        this.highest_observed_flops = 0;
        this.calculate_flops_graph(graph);
    }

    update_flops_map(flops_map) {
        this.flops_map = flops_map;

        this.clear_cached_flops_values();
        this.recalculate_flops_values(this.renderer.graph);

        this.draw();
    }

    shade_node(node, ctx) {
        let flops = node.data.flops;
        let flops_string = node.data.flops_string;

        if (flops_string !== undefined &&
            this.renderer.mousepos !== undefined &&
            node.intersect(this.renderer.mousepos.x, this.renderer.mousepos.y)) {
            // Show the computed FLOPS value if applicable.
            if (isNaN(flops_string) && flops !== undefined)
                this.renderer.tooltip = () => {
                    this.renderer.tooltip_container.innerText = (
                        'FLOPS: ' + flops_string + ' (' + flops + ')'
                    );
                };
            else
                this.renderer.tooltip = () => {
                    this.renderer.tooltip_container.innerText = (
                        'FLOPS: ' + flops_string
                    );
                };
        }

        if (flops === undefined) {
            // If the FLOPS can't be calculated, but there's an entry for this
            // node's FLOPS, that means that there's an unresolved symbol. Shade
            // the node grey to indicate that.
            if (flops_string !== undefined) {
                node.shade(this.renderer, ctx, 'gray');
                return;
            } else {
                return;
            }
        }

        // Only draw positive FLOPS.
        if (flops <= 0)
            return;

        // Use either the default cutoff high value for FLOPS or the maximum
        // observed one to calculate the 'badness' color.
        let badness = (1 / Math.max(
            this.cutoff_high_flops,
            this.highest_observed_flops
        )) * flops;
        let color = getTempColor(badness);

        node.shade(this.renderer, ctx, color);
    }

    recursively_shade_sdfg(graph, ctx, ppp, visible_rect) {
        // First go over visible states, skipping invisible ones. We only draw
        // something if the state is collapsed or we're zoomed out far enough.
        // In that case, we draw the FLOPS calculated for the entire state.
        // If it's expanded or zoomed in close enough, we traverse inside.
        graph.nodes().forEach(v => {
            let state = graph.node(v);

            // If the node's invisible, we skip it.
            if (ctx.lod && !state.intersect(visible_rect.x, visible_rect.y,
                visible_rect.w, visible_rect.h))
                return;

            if ((ctx.lod && (ppp >= STATE_LOD ||
                             state.width / ppp <= STATE_LOD)) ||
                state.data.state.attributes.is_collapsed) {
                this.shade_node(state, ctx);
            } else {
                let state_graph = state.data.graph;
                if (state_graph) {
                    state_graph.nodes().forEach(v => {
                        let node = state_graph.node(v);

                        // Skip the node if it's not visible.
                        if (ctx.lod && !node.intersect(visible_rect.x,
                            visible_rect.y, visible_rect.w, visible_rect.h))
                            return;

                        if (node.data.node.attributes.is_collapsed ||
                            (ctx.lod && ppp >= NODE_LOD)) {
                            this.shade_node(node, ctx);
                        } else {
                            if (node instanceof NestedSDFG) {
                                this.recursively_shade_sdfg(
                                    node.data.graph, ctx, ppp, visible_rect
                                );
                            } else {
                                this.shade_node(node, ctx);
                            }
                        }
                    });
                }
            }
        });
    }

    draw() {
        this.recursively_shade_sdfg(
            this.renderer.graph,
            this.renderer.ctx,
            this.renderer.canvas_manager.points_per_pixel(),
            this.renderer.visible_rect
        );
    }

    on_mouse_event(type, ev, mousepos, elements, foreground_elem, ends_drag) {
        if ((type === 'click' && !ends_drag) || type === 'dblclick') {
            if (foreground_elem) {
                // TODO: For collapsible elements, make sure to only fire it
                // if the element is collapsed or we're zoomed out far enough
                // that contents don't get rendered.
                let flops_string = this.flops_map[
                    this.get_element_uuid(foreground_elem)
                ];
                if (flops_string) {
                    let that = this;
                    this.symbol_resolver.parse_symbol_expression(
                        flops_string, true, () => {
                            that.clear_cached_flops_values();
                            that.recalculate_flops_values(that.renderer.graph);
                        }
                    );
                }
            }
        }
        return false;
    }

}

class MemoryVolumeOverlay extends GenericSdfgOverlay {

    constructor(overlay_manager, renderer) {
        super(
            overlay_manager,
            renderer,
            GenericSdfgOverlay.OVERLAY_TYPE.MEMORY_VOLUME
        );

        // Indicate which volume is considered 'maximum badness', meaning that
        // the badness color scale tops out at this volume.
        this.cutoff_high_volume = 10;
        // The highest observed volume can be used to adjust the 'temperature'
        // scale.
        this.highest_observed_volume = 0;
    }

    draw() {
        this.renderer.for_all_elements(0, 0, 0, 0,
            (type, element, object, intersect) => {
                if (object instanceof Edge) {
                    let ctx = this.renderer.ctx;
                    let edge = object;

                    // Don't draw if we're zoomed out too far.
                    let ppp = this.renderer.canvas_manager.points_per_pixel();
                    if (ctx.lod && ppp >= EDGE_LOD)
                        return;

                    // Don't draw if the edge is outside the visible area.
                    let visible_rect = this.renderer.visible_rect;
                    if (!edge.intersect(visible_rect.x, visible_rect.y,
                        visible_rect.w, visible_rect.h))
                        return;

                    let volume = edge.attributes().volume;
                    if (volume !== undefined)
                        volume = this.symbol_resolver.parse_symbol_expression(
                            volume
                        );

                    if (volume) {
                        // Update the highest obeserved volume if applicable.
                        if (volume > this.highest_observed_volume)
                            this.highest_observed_volume = volume;

                        // Use either the default cutoff high volume, or the
                        // maximum observed volume to indicate the badness of
                        // this edge.
                        let badness = (1 / Math.max(
                            this.cutoff_high_volume,
                            this.highest_observed_volume
                        )) * volume;
                        let color = getTempColor(badness);

                        edge.shade(this.renderer, ctx, color);
                    }
                }
            }
        );
    }

    on_mouse_event(type, ev, mousepos, elements, foreground_elem, ends_drag) {
        if ((type === 'click' && !ends_drag) || type === 'dblclick') {
            if (foreground_elem && foreground_elem.data &&
                foreground_elem.data.attributes &&
                foreground_elem.data.attributes.volume) {
                this.symbol_resolver.parse_symbol_expression(
                    foreground_elem.data.attributes.volume, true
                );
            }
        }
        return false;
    }

}

class OverlayManager {

    constructor (renderer) {
        this.renderer = renderer;

        this.memory_volume_overlay_active = false;
        this.static_flops_overlay_active = false;

        this.overlays = [];

        this.symbol_resolver = new SymbolResolver();
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
            default:
                break;
        }
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
            default:
                break;
        }
    }

    draw() {
        this.overlays.forEach(overlay => {
            overlay.draw();
        });
    }

    on_mouse_event(type, ev, mousepos, elements, foreground_elem, ends_drag) {
        this.overlays.forEach(overlay => {
            overlay.on_mouse_event(type, ev, mousepos, elements,
                foreground_elem, ends_drag);
        });
    }

}