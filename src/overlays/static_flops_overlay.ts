// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import {
    DagreGraph,
    Point2D,
    SimpleRect,
    SymbolMap,
    getGraphElementUUID,
} from '../index';
import { SDFGRenderer } from '../renderer/renderer';
import {
    Edge,
    NestedSDFG,
    SDFGElement,
    SDFGNode,
} from '../renderer/renderer_elements';
import { SDFV } from '../sdfv';
import { getTempColorHslString } from '../utils/utils';
import { GenericSdfgOverlay, OverlayType } from './generic_sdfg_overlay';

export class StaticFlopsOverlay extends GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.NODE;
    public readonly olClass: typeof GenericSdfgOverlay = StaticFlopsOverlay;

    private flops_map: { [uuids: string]: any } = {};

    public constructor(renderer: SDFGRenderer) {
        super(renderer);

        this.renderer.emit(
            'backend_data_requested', 'flops', 'StaticFlopsOverlay'
        );
    }

    public clear_cached_flops_values(): void {
        this.renderer.doForAllGraphElements((_group, _info, obj) => {
            if (obj.data) {
                if (obj.data.flops !== undefined)
                    obj.data.flops = undefined;
                if (obj.data.flops_string !== undefined)
                    obj.data.flops_string = undefined;
            }
        });
    }

    public calculate_flops_node(
        node: SDFGNode, symbol_map: SymbolMap, flops_values: number[]
    ): number | undefined {
        const flops_string = this.flops_map[getGraphElementUUID(node)];
        let flops = undefined;
        if (flops_string !== undefined) {
            flops = this.symbolResolver.parse_symbol_expression(
                flops_string,
                symbol_map
            );
        }

        node.data.flops_string = flops_string;
        node.data.flops = flops;

        if (flops !== undefined && flops > 0)
            flops_values.push(flops);

        return flops;
    }

    public calculate_flops_graph(
        g: DagreGraph, symbol_map: SymbolMap, flops_values: number[]
    ): void {
        g.nodes().forEach(v => {
            const state = g.node(v);
            this.calculate_flops_node(state, symbol_map, flops_values);
            const state_graph = state.data.graph;
            if (state_graph) {
                state_graph.nodes().forEach((v: string) => {
                    const node = state_graph.node(v);
                    if (node instanceof NestedSDFG) {
                        const nested_symbols_map: SymbolMap = {};
                        const mapping =
                            node.data.node.attributes.symbol_mapping ?? {};
                        // Translate the symbol mappings for the nested SDFG
                        // based on the mapping described on the node.
                        Object.keys(mapping).forEach((symbol: string) => {
                            nested_symbols_map[symbol] =
                                this.symbolResolver.parse_symbol_expression(
                                    mapping[symbol],
                                    symbol_map
                                );
                        });
                        // Merge in the parent mappings.
                        Object.keys(symbol_map).forEach((symbol) => {
                            if (!(symbol in nested_symbols_map))
                                nested_symbols_map[symbol] = symbol_map[symbol];
                        });

                        this.calculate_flops_node(
                            node,
                            nested_symbols_map,
                            flops_values
                        );
                        this.calculate_flops_graph(
                            node.data.graph,
                            nested_symbols_map,
                            flops_values
                        );
                    } else {
                        this.calculate_flops_node(
                            node,
                            symbol_map,
                            flops_values
                        );
                    }
                });
            }
        });
    }

    public recalculate_flops_values(graph: DagreGraph): void {
        this.heatmap_scale_center = 5;
        this.heatmap_hist_buckets = [];

        const flops_values: number[] = [];
        this.calculate_flops_graph(
            graph,
            this.symbolResolver.get_symbol_value_map(),
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
        this.clear_cached_flops_values();
        const graph = this.renderer.get_graph();
        if (graph)
            this.recalculate_flops_values(graph);

        this.renderer.draw_async();
    }

    public shade_node(node: SDFGNode, ctx: CanvasRenderingContext2D): void {
        const flops = node.data.flops;
        const flops_string = node.data.flops_string;

        const mousepos = this.renderer.get_mousepos();
        if (flops_string !== undefined && mousepos &&
            node.intersect(mousepos.x, mousepos.y)) {
            // Show the computed FLOPS value if applicable.
            if (isNaN(flops_string) && flops !== undefined) {
                this.renderer.set_tooltip(() => {
                    const tt_cont = this.renderer.get_tooltip_container();
                    if (tt_cont) {
                        tt_cont.innerText = (
                            'FLOPS: ' + flops_string + ' (' + flops + ')'
                        );
                    }
                });
            } else {
                this.renderer.set_tooltip(() => {
                    const tt_cont = this.renderer.get_tooltip_container();
                    if (tt_cont)
                        tt_cont.innerText = 'FLOPS: ' + flops_string;
                });
            }
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

        // Calculate the severity color.
        const color = getTempColorHslString(this.getSeverityValue(flops));

        node.shade(this.renderer, ctx, color);
    }

    public recursively_shade_sdfg(
        graph: DagreGraph,
        ctx: CanvasRenderingContext2D,
        ppp: number,
        visible_rect: SimpleRect
    ): void {
        // First go over visible states, skipping invisible ones. We only draw
        // something if the state is collapsed or we're zoomed out far enough.
        // In that case, we draw the FLOPS calculated for the entire state.
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
                        getGraphElementUUID(foreground_elem)
                    ];
                    if (flops_string) {
                        this.symbolResolver.parse_symbol_expression(
                            flops_string,
                            this.symbolResolver.get_symbol_value_map(),
                            true,
                            () => {
                                this.clear_cached_flops_values();
                                const graph = this.renderer.get_graph();
                                if (graph)
                                    this.recalculate_flops_values(graph);
                            }
                        );
                    }
                }
            }
        }
        return false;
    }

}
