import { NestedSDFG } from '../renderer/renderer_elements';
import { mean, median } from 'mathjs';


export class MemoryVolumeOverlay {

    constructor(settings, graph) {
        this.symbol_resolver = settings.symbol_resolver;
        this.badness_scale_method = settings.badness_scale_method;
        this.graph = graph;
    }

    static computeOverlay(graph, symbolResolver, badnessScaleMethod = 'median') {
        const mvo = new MemoryVolumeOverlay({
            badness_scale_method: badnessScaleMethod,
            symbol_resolver: symbolResolver,
        }, graph);
        mvo.refresh();
        return {
            badnessScaleCenter: mvo.badness_scale_center,
        }
    }

    clear_cached_volume_values() {
        [...this.graph.allNodes(), ...this.graph.allEdges()].forEach((obj) => {
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
        const that = this;
        g.nodes().forEach(state => {
            const state_graph = state.data.graph;
            if (state_graph) {
                state_graph.edges().forEach(edge => {
                    that.calculate_volume_edge(
                        edge,
                        symbol_map,
                        volume_values
                    );
                });

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

    recalculate_volume_values() {
        const volume_values = [0];
        this.calculate_volume_graph(
            this.graph,
            this.symbol_resolver.symbol_value_map,
            volume_values
        );

        switch (this.badness_scale_method) {
            case 'mean':
                this.badness_scale_center = mean(volume_values);
                break;
            case 'median':
            default:
                this.badness_scale_center = median(volume_values);
                break;
        }
    }

    refresh() {
        this.clear_cached_volume_values();
        this.recalculate_volume_values();
    }

    on_mouse_event(type, ev, mousepos, elements, foreground_elem, ends_drag) {
        if (type === 'click' && !ends_drag) {
            if (foreground_elem !== undefined &&
                foreground_elem instanceof Edge) {
                if (foreground_elem.data.volume === undefined) {
                    if (foreground_elem.data.attributes.volume) {
                        const that = this;
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
