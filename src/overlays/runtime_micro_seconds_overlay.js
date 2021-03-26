import { MapExit, NestedSDFG, SDFGNode, State } from '../renderer/renderer_elements';
import { GenericSdfgOverlay } from './generic_sdfg_overlay';
import { mean, median } from 'mathjs';
import { getTempColor } from '../renderer/renderer_elements';


export class RuntimeMicroSecondsOverlay extends GenericSdfgOverlay {

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
            // entry node instead, because the runtime is held there.
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

    refresh() {
        this.badness_scale_center = 5;

        const micros_values = [0];

        for (const key of Object.keys(this.runtime_map)) {
            // Make sure the overall SDFG's runtime isn't included in this.
            if (key !== '0/-1/-1/-1')
                micros_values.push(this.runtime_map[key][this.criterium]);
        }

        switch (this.overlay_manager.badness_scale_method) {
            case 'mean':
                this.badness_scale_center = mean(micros_values);
                break;
            case 'median':
            default:
                this.badness_scale_center = median(micros_values);
                break;
        }

        this.renderer.draw_async();
    }

    pretty_print_micros(micros) {
        let unit = 'µs';
        let value = micros;
        if (micros > 1000) {
            unit = 'ms';
            const millis = micros / 1000;
            value = millis;
            if (millis > 1000) {
                unit = 's';
                const seconds = millis / 1000;
                value = seconds;
            }
        }

        value = Math.round((value + Number.EPSILON) * 100) / 100;
        return value.toString() + ' ' + unit;
    }

    shade_node(node, ctx) {
        const rt_summary = this.runtime_map[this.get_element_uuid(node)];

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
        const color = getTempColor(badness);

        node.shade(this.renderer, ctx, color);
    }

    recursively_shade_sdfg(graph, ctx, ppp, visible_rect) {
        // First go over visible states, skipping invisible ones. We only draw
        // something if the state is collapsed or we're zoomed out far enough.
        // In that case, we draw the measured runtime for the entire state.
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

}
