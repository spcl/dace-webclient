// Copyright 2019-2022 ETH Zurich and the DaCe authors. All rights reserved.

import { Node } from 'dagre';
import { DagreSDFG, SimpleRect } from '../index';
import { SDFGRenderer } from '../renderer/renderer';
import { NestedSDFG, SDFGNode } from '../renderer/renderer_elements';
import { SDFV } from '../sdfv';
import { getTempColorHslString, get_element_uuid } from '../utils/utils';
import {
    GenericSdfgOverlay,
    OverlayType,
    RuntimeReportOverlay
} from './generic_sdfg_overlay';


export class RuntimeMicroSecondsOverlay extends RuntimeReportOverlay {

    public static readonly type: OverlayType = OverlayType.NODE;
    public readonly olClass: typeof GenericSdfgOverlay =
        RuntimeMicroSecondsOverlay;

    protected criterium: string = 'mean';
    private runtime_map: { [uuids: string]: any } = {}

    public constructor(renderer: SDFGRenderer) {
        super(renderer);
        this.heatmap_scale_center = 0;
    }

    public refresh(): void {
        this.heatmap_scale_center = 5;
        this.heatmap_hist_buckets = [];

        const micros_values = [];

        for (const key of Object.keys(this.runtime_map)) {
            // Make sure the overall SDFG's runtime isn't included in this.
            if (key !== '0/-1/-1/-1')
                micros_values.push(this.runtime_map[key][this.criterium]);
        }

        this.update_heatmap_scale(micros_values);

        if (micros_values.length === 0)
            micros_values.push(0);

        this.renderer.draw_async();
    }

    public pretty_print_micros(micros: number): string {
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

    public shade_node(node: SDFGNode, ctx: CanvasRenderingContext2D): void {
        const rt_summary = this.runtime_map[get_element_uuid(node)];

        if (rt_summary === undefined)
            return;

        const mousepos = this.renderer.get_mousepos();
        if (mousepos && node.intersect(mousepos.x, mousepos.y)) {
            // Show the measured runtime.
            if (rt_summary['min'] === rt_summary['max'])
                this.renderer.set_tooltip(() => {
                    const tt_cont = this.renderer.get_tooltip_container();
                    if (tt_cont)
                        tt_cont.innerText = this.pretty_print_micros(
                            rt_summary['min']
                        );
                });

            else
                this.renderer.set_tooltip(() => {
                    const tt_cont = this.renderer.get_tooltip_container();
                    if (tt_cont)
                        tt_cont.innerText = (
                            'Min: ' +
                            this.pretty_print_micros(rt_summary['min']) +
                            '\nMax: ' +
                            this.pretty_print_micros(rt_summary['max']) +
                            '\nMean: ' +
                            this.pretty_print_micros(rt_summary['mean']) +
                            '\nMedian: ' +
                            this.pretty_print_micros(rt_summary['med']) +
                            '\nCount: ' +
                            rt_summary['count']
                        );
                });
        }

        // Calculate the severity color.
        const micros = rt_summary[this.criterium];
        const color = getTempColorHslString(this.get_severity_value(micros));

        node.shade(this.renderer, ctx, color);
    }

    public recursively_shade_sdfg(
        graph: DagreSDFG,
        ctx: CanvasRenderingContext2D,
        ppp: number,
        visible_rect: SimpleRect
    ): void {
        // First go over visible states, skipping invisible ones. We only draw
        // something if the state is collapsed or we're zoomed out far enough.
        // In that case, we draw the measured runtime for the entire state.
        // If it's expanded or zoomed in close enough, we traverse inside.
        graph.nodes().forEach(v => {
            const state: Node<SDFGNode> = graph.node(v);

            // If the node's invisible, we skip it.
            if ((ctx as any).lod && !state.intersect(
                visible_rect.x, visible_rect.y,
                visible_rect.w, visible_rect.h
            ))
                return;

            const stateppp = Math.sqrt(state.width * state.height) / ppp;
            if (((ctx as any).lod && (ppp >= SDFV.STATE_LOD ||
                stateppp <= SDFV.STATE_LOD)) ||
                state.data.state.attributes.is_collapsed) {
                this.shade_node(state, ctx);
            } else {
                const state_graph = state.data.graph;
                if (state_graph) {
                    state_graph.nodes().forEach((v: string) => {
                        const node = state_graph.node(v);

                        // Skip the node if it's not visible.
                        if ((ctx as any).lod && !node.intersect(visible_rect.x,
                            visible_rect.y, visible_rect.w, visible_rect.h))
                            return;

                        if (node.data.node.attributes.is_collapsed ||
                            ((ctx as any).lod && ppp > SDFV.NODE_LOD)) {
                            this.shade_node(node, ctx);
                        } else {
                            if (node instanceof NestedSDFG &&
                                node.attributes().sdfg &&
                                node.attributes().sdfg.type !== 'SDFGShell') {
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

    public draw(): void {
        const graph = this.renderer.get_graph();
        const ppp = this.renderer.get_canvas_manager()?.points_per_pixel();
        const context = this.renderer.get_context();
        const visible_rect = this.renderer.get_visible_rect();
        if (graph && ppp !== undefined && context && visible_rect)
            this.recursively_shade_sdfg(graph, context, ppp, visible_rect);
    }

    public set_runtime_map(runtime_map: { [uuids: string]: any }): void {
        this.runtime_map = runtime_map;
    }

    public clearRuntimeData(): void {
        this.set_runtime_map({});
        this.refresh();
    }

}
