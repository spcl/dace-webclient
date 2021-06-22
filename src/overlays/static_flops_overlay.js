import { MapExit, NestedSDFG, SDFGNode, State } from '../renderer/renderer_elements';
import { GenericSdfgOverlay } from './generic_sdfg_overlay';
import { mean, median } from 'mathjs';
import { getTempColor } from '../renderer/renderer_elements';


export class StaticFlopsOverlay extends GenericSdfgOverlay {

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
        const undefined_val = -1;
        if (element instanceof State) {
            return (
                element.sdfg.sdfg_list_id + '/' +
                element.id + '/' +
                undefined_val + '/' +
                undefined_val
            );
        } else if (element instanceof NestedSDFG) {
            const sdfg_id = element.data.node.attributes.sdfg.sdfg_list_id;
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
        } else if (element instanceof SDFGNode) {
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
        const flops_string = this.flops_map[this.get_element_uuid(node)];
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
        const that = this;
        g.nodes().forEach(v => {
            const state = g.node(v);
            that.calculate_flops_node(state, symbol_map, flops_values);
            const state_graph = state.data.graph;
            if (state_graph) {
                state_graph.nodes().forEach(v => {
                    const node = state_graph.node(v);
                    if (node instanceof NestedSDFG) {
                        const nested_symbols_map = {};
                        const mapping = node.data.node.attributes.symbol_mapping;
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

        const flops_values = [0];
        this.calculate_flops_graph(
            graph,
            this.symbol_resolver.symbol_value_map,
            flops_values
        );

        switch (this.overlay_manager.badness_scale_method) {
            case 'mean':
                this.badness_scale_center = mean(flops_values);
                break;
            case 'median':
            default:
                this.badness_scale_center = median(flops_values);
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
        const flops = node.data.flops;
        const flops_string = node.data.flops_string;

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
        const color = getTempColor(badness);

        node.shade(this.renderer, ctx, color);
    }

    recursively_shade_sdfg(graph, ctx, ppp, visible_rect) {
        // First go over visible states, skipping invisible ones. We only draw
        // something if the state is collapsed or we're zoomed out far enough.
        // In that case, we draw the FLOPS calculated for the entire state.
        // If it's expanded or zoomed in close enough, we traverse inside.
        graph.nodes().forEach(v => {
            const state = graph.node(v);

            // If the node's invisible, we skip it.
            if (ctx.lod && !state.intersect(visible_rect.x, visible_rect.y,
                visible_rect.w, visible_rect.h))
                return;

            if ((ctx.lod && (ppp >= STATE_LOD ||
                state.width / ppp <= STATE_LOD)) ||
                state.data.state.attributes.is_collapsed) {
                this.shade_node(state, ctx);
            } else {
                const state_graph = state.data.graph;
                if (state_graph) {
                    state_graph.nodes().forEach(v => {
                        const node = state_graph.node(v);

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
                    const flops_string = this.flops_map[this.get_element_uuid(foreground_elem)];
                    if (flops_string) {
                        const that = this;
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
