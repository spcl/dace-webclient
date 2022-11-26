// Copyright 2019-2022 ETH Zurich and the DaCe authors. All rights reserved.

import { DagreSDFG, Point2D, SimpleRect, SymbolMap } from '../index';
import { SDFGRenderer, SDFGRendererEvent } from '../renderer/renderer';
import {
    Edge,
    NestedSDFG,
    SDFGElement,
    SDFGNode
} from '../renderer/renderer_elements';
import { SDFV } from '../sdfv';
import { getTempColorHslString, get_element_uuid } from '../utils/utils';
import { GenericSdfgOverlay, OverlayType } from './generic_sdfg_overlay';

export class OperationalIntensityOverlay extends GenericSdfgOverlay {

    public static type: OverlayType = OverlayType.NODE;

    private flops_map: { [uuids: string]: any } = {};

    public constructor(renderer: SDFGRenderer) {
        super(renderer);

        this.renderer.emit_event(SDFGRendererEvent.BACKEND_DATA_REQUESTED, {
            type: 'flops',
            overlay: 'OperationalIntensityOverlay',
        });
    }

    public clear_cached_values(): void {
        this.renderer.for_all_elements(0, 0, 0, 0, (
            type: string, e: MouseEvent, obj: any,
        ) => {
            if (obj.data) {
                if (obj.data.volume !== undefined)
                    obj.data.volume = undefined;
                if (obj.data.flops !== undefined)
                    obj.data.flops = undefined;
                if (obj.data.flops_string !== undefined)
                    obj.data.flops_string = undefined;
                if (obj.data.opint !== undefined)
                    obj.data.opint = undefined;
            }
        });
    }

    public calculate_opint_node(
        node: SDFGNode, symbol_map: SymbolMap, opint_values: number[]
    ): number | undefined {
        if (node.parent_id === undefined || node.parent_id === null)
            return;

        const flops_string = this.flops_map[get_element_uuid(node)];
        let flops = undefined;
        if (flops_string !== undefined)
            flops = this.symbol_resolver.parse_symbol_expression(
                flops_string, symbol_map
            );

        node.data.flops_string = flops_string;
        node.data.flops = flops;

        const io_volumes = [];
        const io_edges = [];

        for (const e of node.sdfg.nodes[node.parent_id].edges) {
            if (e.src == node.id || e.dst == node.id)
                io_edges.push(e);
        }

        for (const edge of io_edges) {
            let volume_string = undefined;
            let volume = undefined;
            if (!edge.attributes?.data?.volume) {
                if (edge.attributes?.data?.attributes) {
                    volume_string = edge.attributes.data.attributes.volume;
                    if (volume_string !== undefined) {
                        volume_string = volume_string.replace(/\*\*/g, '^');
                        volume_string = volume_string.replace(
                            /ceiling/g, 'ceil'
                        );
                    }
                }
            } else {
                volume = edge.attributes.data.volume;
            }

            if (volume_string !== undefined)
                volume = this.symbol_resolver.parse_symbol_expression(
                    volume_string, symbol_map
                );

            edge.attributes.data.volume = volume;

            if (volume !== undefined && volume > 0) {
                let io_dt = '';
                if (edge.attributes?.data?.attributes?.data) {
                    const array = node.sdfg.attributes._arrays[
                        edge.attributes.data.attributes.data
                    ];
                    io_dt = array.attributes.dtype;
                }
                io_volumes.push({
                    volume: volume,
                    dtype: io_dt,
                });
            }
        }

        let opint = undefined;
        if (flops !== undefined && flops > 0 && io_volumes) {
            let total_volume = 0;
            for (const io_vol of io_volumes)
                total_volume += io_vol.volume;
            if (total_volume > 0)
                opint = flops / total_volume;
        }
        if (opint !== undefined && opint > 0)
            opint_values.push(opint);

        node.data.opint = opint;
        return opint;
    }

    public calculate_opint_graph(
        g: DagreSDFG, symbol_map: SymbolMap, flops_values: number[]
    ): void {
        g.nodes().forEach(v => {
            const state = g.node(v);
            this.calculate_opint_node(state, symbol_map, flops_values);
            const state_graph = state.data.graph;
            if (state_graph) {
                state_graph.nodes().forEach((v: string) => {
                    const node = state_graph.node(v);
                    if (node instanceof NestedSDFG) {
                        const nested_symbols_map: SymbolMap = {};
                        const mapping =
                            node.data.node.attributes.symbol_mapping;
                        // Translate the symbol mappings for the nested SDFG
                        // based on the mapping described on the node.
                        Object.keys(mapping).forEach((symbol: string) => {
                            nested_symbols_map[symbol] =
                                this.symbol_resolver.parse_symbol_expression(
                                    mapping[symbol],
                                    symbol_map
                                );
                        });
                        // Merge in the parent mappings.
                        Object.keys(symbol_map).forEach((symbol) => {
                            if (!(symbol in nested_symbols_map))
                                nested_symbols_map[symbol] = symbol_map[symbol];
                        });

                        this.calculate_opint_node(
                            node,
                            nested_symbols_map,
                            flops_values
                        );
                        this.calculate_opint_graph(
                            node.data.graph,
                            nested_symbols_map,
                            flops_values
                        );
                    } else {
                        this.calculate_opint_node(
                            node,
                            symbol_map,
                            flops_values
                        );
                    }
                });
            }
        });
    }

    public recalculate_opint_values(graph: DagreSDFG): void {
        this.heatmap_scale_center = 5;
        this.heatmap_hist_buckets = [];

        const flops_values: number[] = [];
        this.calculate_opint_graph(
            graph,
            this.symbol_resolver.get_symbol_value_map(),
            flops_values
        );

        this.update_heatmap_scale(flops_values);

        if (flops_values.length === 0)
            flops_values.push(0);
    }

    public update_flops_map(flops_map: { [uuids: string]: any }): void {
        this.flops_map = flops_map;
        this.refresh();
    }

    public refresh(): void {
        this.clear_cached_values();
        const graph = this.renderer.get_graph();
        if (graph)
            this.recalculate_opint_values(graph);

        this.renderer.draw_async();
    }

    public shade_node(node: SDFGNode, ctx: CanvasRenderingContext2D): void {
        const opint = node.data.opint;

        const mousepos = this.renderer.get_mousepos();
        if (opint !== undefined && mousepos &&
            node.intersect(mousepos.x, mousepos.y)) {
            // Show the computed OP-INT value if applicable.
            this.renderer.set_tooltip(() => {
                const tt_cont = this.renderer.get_tooltip_container();
                if (tt_cont)
                    tt_cont.innerText = 'Operational Intensity: ' + opint;
            });
        }

        if (opint === undefined)
            return;

        // Only draw positive OP-INTs.
        if (opint <= 0)
            return;

        // Calculate the severity color.
        const color = getTempColorHslString(this.get_severity_value(opint));

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
        // In that case, we draw the OP-INT calculated for the entire state.
        // If it's expanded or zoomed in close enough, we traverse inside.
        graph.nodes().forEach(v => {
            const state = graph.node(v);

            // If the node's invisible, we skip it.
            if ((ctx as any).lod && !state.intersect(
                visible_rect.x, visible_rect.y,
                visible_rect.w, visible_rect.h
            ))
                return;

            if (((ctx as any).lod && (ppp >= SDFV.STATE_LOD ||
                state.width / ppp <= SDFV.STATE_LOD)) ||
                state.data.state.attributes.is_collapsed) {
                this.shade_node(state, ctx);
            } else {
                const state_graph = state.data.graph;
                if (state_graph) {
                    state_graph.nodes().forEach((v: any) => {
                        const node = state_graph.node(v);

                        // Skip the node if it's not visible.
                        if ((ctx as any).lod && !node.intersect(visible_rect.x,
                            visible_rect.y, visible_rect.w, visible_rect.h))
                            return;

                        if (node.data.node.attributes.is_collapsed ||
                            ((ctx as any).lod && ppp >= SDFV.NODE_LOD)) {
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

    public draw(): void {
        const graph = this.renderer.get_graph();
        const ppp = this.renderer.get_canvas_manager()?.points_per_pixel();
        const context = this.renderer.get_context();
        const visible_rect = this.renderer.get_visible_rect();
        if (graph && ppp !== undefined && context && visible_rect)
            this.recursively_shade_sdfg(graph, context, ppp, visible_rect);
    }

    public on_mouse_event(
        type: string,
        _ev: Event,
        _mousepos: Point2D,
        _elements: SDFGElement[],
        foreground_elem: SDFGElement,
        ends_drag: boolean
    ): boolean {
        if (type === 'click' && !ends_drag) {
            if (foreground_elem !== undefined && foreground_elem !== null &&
                !(foreground_elem instanceof Edge)) {
                if (foreground_elem.data.flops === undefined) {
                    const flops_string = this.flops_map[
                        get_element_uuid(foreground_elem)
                    ];
                    if (flops_string) {
                        this.symbol_resolver.parse_symbol_expression(
                            flops_string,
                            this.symbol_resolver.get_symbol_value_map(),
                            true,
                            () => {
                                this.clear_cached_values();
                                const graph = this.renderer.get_graph();
                                if (graph)
                                    this.recalculate_opint_values(graph);
                            }
                        );
                    }
                }
            }
        }
        return false;
    }

}
