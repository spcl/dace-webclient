import { MapExit, NestedSDFG, SDFGNode, State } from '../renderer/renderer_elements';
import { GenericSdfgOverlay } from './generic_sdfg_overlay';
import { mean, median } from 'mathjs';
import { getTempColor } from '../renderer/renderer_elements';


export class StaticFlopsOverlay extends GenericSdfgOverlay {

    constructor(overlay_manager, renderer) {
        super(
            overlay_manager,
            renderer
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
        g.nodes().forEach(state => {
            that.calculate_flops_node(state, symbol_map, flops_values);
            const state_graph = state.data.graph;
            if (state_graph) {
                state_graph.nodes().forEach(node => {
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
}
