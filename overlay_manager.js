// Copyright 2019-2020 ETH Zurich and the DaCe authors. All rights reserved.

class SymbolResolver {

    constructor(renderer) {
        this.renderer = renderer;
        this.sdfg = this.renderer.sdfg;
        try {
            this.vscode = vscode;
        } catch(exception) {
            this.vscode = false;
        }

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
        prompt_completion=false,
        callback=undefined
    ) {
        let result = undefined;
        try {
            let expression_tree = math.parse(expression_string);
            if (prompt_completion) {
                this.recursive_find_undefined_symbol(expression_tree, mapping);
                this.prompt_define_symbol(mapping, callback);
            } else {
                try {
                    let evaluated =
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

    prompt_define_symbol(mapping, callback=undefined) {
        if (this.symbols_to_define.length > 0) {
            let symbol = this.symbols_to_define.pop();
            let that = this;
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

    constructor(overlay_manager, renderer, type) {
        this.overlay_manager = overlay_manager;
        this.symbol_resolver = this.overlay_manager.symbol_resolver;
        this.renderer = renderer;
        this.type = type;
        try {
            this.vscode = vscode;
        } catch(exception) {
            this.vscode = false;
        }

        this.badness_scale_center = 5;
    }

    draw() {
    }

    on_mouse_event(type, ev, mousepos, elements, foreground_elem, ends_drag) {
        return false;
    }

    refresh(){
    }

}

GenericSdfgOverlay.OVERLAY_TYPE = {
    MEMORY_VOLUME: 'OVERLAY_TYPE_MEMORY_VOLUME',
    STATIC_FLOPS: 'OVERLAY_TYPE_STATIC_FLOPS',
    RUNTIME_US: 'OVERLAY_TYPE_RUNTIME_US',
};

class RuntimeMicroSecondsOverlay extends GenericSdfgOverlay {

    constructor(overlay_manager, renderer) {
        super(
            overlay_manager,
            renderer,
            GenericSdfgOverlay.OVERLAY_TYPE.RUNTIME_US
        );

        this.criterium = 'mean';
        this.runtime_map = {};

        this.badness_scale_center = 0;
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
            // entry node instead, because the runtime is held there.
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

    refresh() {
        this.badness_scale_center = 5;

        let micros_values = [0];

        for (const key of Object.keys(this.runtime_map)) {
            // Make sure the overall SDFG's runtime isn't included in this.
            if (key !== '0/-1/-1/-1')
                micros_values.push(this.runtime_map[key][this.criterium]);
        }

        switch (this.overlay_manager.badness_scale_method) {
            case 'mean':
                this.badness_scale_center = math.mean(micros_values);
                break;
            case 'median':
            default:
                this.badness_scale_center = math.median(micros_values);
                break;
        }

        this.renderer.draw_async();
    }

    pretty_print_micros(micros) {
        let unit = 'µs';
        let value = micros;
        if (micros > 1000) {
            unit = 'ms';
            let millis = micros / 1000;
            value = millis;
            if (millis > 1000) {
                unit = 's';
                let seconds = millis / 1000;
                value = seconds;
            }
        }

        value = Math.round((value + Number.EPSILON) * 100) / 100;
        return value.toString() + ' ' + unit;
    }

    shade_node(node, ctx) {
        let rt_summary = this.runtime_map[this.get_element_uuid(node)];

        if (rt_summary === undefined)
            return;

        if (this.renderer.mousepos &&
            node.intersect(this.renderer.mousepos.x, this.renderer.mousepos.y)) {
            // Show the measured runtime.
            if (rt_summary['min'] === rt_summary['max'])
                this.renderer.tooltip = () => {
                    this.renderer.tooltip_container.innerText = (
                        this.pretty_print_micros(rt_summary['min'])
                    );
                };
            else
                this.renderer.tooltip = () => {
                    this.renderer.tooltip_container.innerText = (
                        'Min: ' + this.pretty_print_micros(rt_summary['min']) +
                        '\nMax: ' + this.pretty_print_micros(rt_summary['max']) +
                        '\nMean: ' + this.pretty_print_micros(rt_summary['mean']) +
                        '\nMedian: ' + this.pretty_print_micros(rt_summary['med']) +
                        '\nCount: ' + rt_summary['count']
                    );
                };
        }

        // Calculate the 'badness' color.
        const micros = rt_summary[this.criterium];
        let badness = (1 / (this.badness_scale_center * 2)) * micros;
        if (badness < 0)
            badness = 0;
        if (badness > 1)
            badness = 1;
        let color = getTempColor(badness);

        node.shade(this.renderer, ctx, color);
    }

    recursively_shade_sdfg(graph, ctx, ppp, visible_rect) {
        // First go over visible states, skipping invisible ones. We only draw
        // something if the state is collapsed or we're zoomed out far enough.
        // In that case, we draw the measured runtime for the entire state.
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

}

class StaticFlopsOverlay extends GenericSdfgOverlay {

    constructor(overlay_manager, renderer) {
        super(
            overlay_manager,
            renderer,
            GenericSdfgOverlay.OVERLAY_TYPE.STATIC_FLOPS
        );

        this.flops_map = {};

        if (this.vscode) {
            vscode.postMessage({
                type: 'dace.get_flops',
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

    calculate_flops_node(node, symbol_map, flops_values) {
        let flops_string = this.flops_map[this.get_element_uuid(node)];
        let flops = undefined;
        if (flops_string !== undefined)
            flops = this.symbol_resolver.parse_symbol_expression(
                flops_string,
                symbol_map
            );

        node.data.flops_string = flops_string;
        node.data.flops = flops;

        if (flops !== undefined && flops > 0)
            flops_values.push(flops);

        return flops;
    }
    
    calculate_flops_graph(g, symbol_map, flops_values) {
        let that = this;
        g.nodes().forEach(v => {
            let state = g.node(v);
            that.calculate_flops_node(state, symbol_map, flops_values);
            let state_graph = state.data.graph;
            if (state_graph) {
                state_graph.nodes().forEach(v => {
                    let node = state_graph.node(v);
                    if (node instanceof NestedSDFG) {
                        let nested_symbols_map = {};
                        let mapping = node.data.node.attributes.symbol_mapping;
                        // Translate the symbol mappings for the nested SDFG
                        // based on the mapping described on the node.
                        Object.keys(mapping).forEach((symbol) => {
                            nested_symbols_map[symbol] =
                                that.symbol_resolver.parse_symbol_expression(
                                    mapping[symbol],
                                    symbol_map
                                );
                        });
                        // Merge in the parent mappings.
                        Object.keys(symbol_map).forEach((symbol) => {
                            if (!(symbol in nested_symbols_map))
                                nested_symbols_map[symbol] = symbol_map[symbol];
                        });

                        that.calculate_flops_node(
                            node,
                            nested_symbols_map,
                            flops_values
                        );
                        that.calculate_flops_graph(
                            node.data.graph,
                            nested_symbols_map,
                            flops_values
                        );
                    } else {
                        that.calculate_flops_node(
                            node,
                            symbol_map,
                            flops_values
                        );
                    }
                });
            }
        });
    }

    recalculate_flops_values(graph) {
        this.badness_scale_center = 5;

        let flops_values = [0];
        this.calculate_flops_graph(
            graph,
            this.symbol_resolver.symbol_value_map,
            flops_values
        );

        switch (this.overlay_manager.badness_scale_method) {
            case 'mean':
                this.badness_scale_center = math.mean(flops_values);
                break;
            case 'median':
            default:
                this.badness_scale_center = math.median(flops_values);
                break;
        }
    }

    update_flops_map(flops_map) {
        this.flops_map = flops_map;
        this.refresh();
    }

    refresh() {
        this.clear_cached_flops_values();
        this.recalculate_flops_values(this.renderer.graph);

        this.renderer.draw_async();
    }

    shade_node(node, ctx) {
        let flops = node.data.flops;
        let flops_string = node.data.flops_string;

        if (flops_string !== undefined && this.renderer.mousepos &&
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

        // Calculate the 'badness' color.
        let badness = (1 / (this.badness_scale_center * 2)) * flops;
        if (badness < 0)
            badness = 0;
        if (badness > 1)
            badness = 1;
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
        if (type === 'click' && !ends_drag) {
            if (foreground_elem !== undefined && foreground_elem !== null &&
                !(foreground_elem instanceof Edge)) {
                if (foreground_elem.data.flops === undefined) {
                    let flops_string = this.flops_map[
                        this.get_element_uuid(foreground_elem)
                    ];
                    if (flops_string) {
                        let that = this;
                        this.symbol_resolver.parse_symbol_expression(
                            flops_string,
                            that.symbol_resolver.symbol_value_map,
                            true,
                            () => {
                                that.clear_cached_flops_values();
                                that.recalculate_flops_values(
                                    that.renderer.graph
                                );
                            }
                        );
                    }
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

        this.refresh();
    }

    clear_cached_volume_values() {
        this.renderer.for_all_elements(0, 0, 0, 0, (type, e, obj, isected) => {
            if (obj.data) {
                if (obj.data.volume !== undefined)
                    obj.data.volume = undefined;
            }
        });
    }

    calculate_volume_edge(edge, symbol_map, volume_values) {
        let volume_string = undefined;
        if (edge.data && edge.data.attributes) {
            volume_string = edge.data.attributes.volume;
            if (volume_string !== undefined) {
                volume_string = volume_string.replace(/\*\*/g, '^');
                volume_string = volume_string.replace(/ceiling/g, 'ceil');
            }
        }
        let volume = undefined;
        if (volume_string !== undefined)
            volume = this.symbol_resolver.parse_symbol_expression(
                volume_string,
                symbol_map
            );

        edge.data.volume = volume;

        if (volume !== undefined && volume > 0)
            volume_values.push(volume);

        return volume;
    }

    calculate_volume_graph(g, symbol_map, volume_values) {
        let that = this;
        g.nodes().forEach(v => {
            let state = g.node(v);
            let state_graph = state.data.graph;
            if (state_graph) {
                state_graph.edges().forEach(e => {
                    let edge = state_graph.edge(e);
                    if (edge instanceof Edge)
                        that.calculate_volume_edge(
                            edge,
                            symbol_map,
                            volume_values
                        );
                });

                state_graph.nodes().forEach(v => {
                    let node = state_graph.node(v);
                    if (node instanceof NestedSDFG) {
                        let nested_symbols_map = {};
                        let mapping = node.data.node.attributes.symbol_mapping;
                        // Translate the symbol mappings for the nested SDFG
                        // based on the mapping described on the node.
                        Object.keys(mapping).forEach((symbol) => {
                            nested_symbols_map[symbol] =
                                that.symbol_resolver.parse_symbol_expression(
                                    mapping[symbol],
                                    symbol_map
                                );
                        });
                        // Merge in the parent mappings.
                        Object.keys(symbol_map).forEach((symbol) => {
                            if (!(symbol in nested_symbols_map))
                                nested_symbols_map[symbol] = symbol_map[symbol];
                        });

                        that.calculate_volume_graph(
                            node.data.graph,
                            nested_symbols_map,
                            volume_values
                        );
                    }
                });
            }
        });
    }

    recalculate_volume_values(graph) {
        this.badness_scale_center = 5;

        let volume_values = [0];
        this.calculate_volume_graph(
            graph,
            this.symbol_resolver.symbol_value_map,
            volume_values
        );

        switch (this.overlay_manager.badness_scale_method) {
            case 'mean':
                this.badness_scale_center = math.mean(volume_values);
                break;
            case 'median':
            default:
                this.badness_scale_center = math.median(volume_values);
                break;
        }
    }

    refresh() {
        this.clear_cached_volume_values();
        this.recalculate_volume_values(this.renderer.graph);

        this.renderer.draw_async();
    }

    shade_edge(edge, ctx) {
        let volume = edge.data.volume;
        if (volume !== undefined) {
            // Only draw positive volumes.
            if (volume <= 0)
                return;

            let badness = (1 / (this.badness_scale_center * 2)) * volume;
            if (badness < 0)
                badness = 0;
            if (badness > 1)
                badness = 1;
            let color = getTempColor(badness);

            edge.shade(this.renderer, ctx, color);
        }
    }

    recursively_shade_sdfg(graph, ctx, ppp, visible_rect) {
        graph.nodes().forEach(v => {
            let state = graph.node(v);

            // If we're zoomed out enough that the contents aren't visible, we
            // skip the state.
            if (ctx.lod && (ppp >= STATE_LOD || state.width / ppp < STATE_LOD))
                return;

            // If the node's invisible, we skip it.
            if (ctx.lod && !state.intersect(visible_rect.x, visible_rect.y,
                visible_rect.w, visible_rect.h))
                return;

            let state_graph = state.data.graph;
            if (state_graph && !state.data.state.attributes.is_collapsed) {
                state_graph.nodes().forEach(v => {
                    let node = state_graph.node(v);

                    // Skip the node if it's not visible.
                    if (ctx.lod && !node.intersect(visible_rect.x,
                        visible_rect.y, visible_rect.w, visible_rect.h))
                        return;

                    // If we're zoomed out enough that the node's contents
                    // aren't visible or the node is collapsed, we skip it.
                    if (node.data.node.attributes.is_collapsed ||
                        (ctx.lod && ppp >= NODE_LOD))
                        return;

                    if (node instanceof NestedSDFG)
                        this.recursively_shade_sdfg(
                            node.data.graph, ctx, ppp, visible_rect
                        );
                });

                state_graph.edges().forEach(e => {
                    let edge = state_graph.edge(e);

                    if (ctx.lod && !edge.intersect(visible_rect.x,
                        visible_rect.y, visible_rect.w, visible_rect.h))
                        return;

                    this.shade_edge(edge, ctx);
                });
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
        if (type === 'click' && !ends_drag) {
            if (foreground_elem !== undefined &&
                foreground_elem instanceof Edge) {
                if (foreground_elem.data.volume === undefined) {
                    if (foreground_elem.data.attributes.volume) {
                        let that = this;
                        this.symbol_resolver.parse_symbol_expression(
                            foreground_elem.data.attributes.volume,
                            that.symbol_resolver.symbol_value_map,
                            true,
                            () => {
                                that.clear_cached_volume_values();
                                that.recalculate_volume_values(
                                    that.renderer.graph
                                );
                            }
                        );
                    }
                }
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