// Copyright 2019-2023 ETH Zurich and the DaCe authors. All rights reserved.

import { DagreSDFG, Point2D, SimpleRect, SymbolMap } from '../index';
import { SDFGRenderer } from '../renderer/renderer';
import {
    Edge,
    NestedSDFG,
    SDFGElement,
    SDFGNode
} from '../renderer/renderer_elements';
import { SDFV } from '../sdfv';
import { getTempColorHslString, get_element_uuid } from '../utils/utils';
import { GenericSdfgOverlay, OverlayType } from './generic_sdfg_overlay';

export class DepthOverlay extends GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.NODE;
    public readonly olClass: typeof GenericSdfgOverlay = DepthOverlay;

    private depth_map: { [uuids: string]: any } = {};

    public constructor(renderer: SDFGRenderer) {
        super(renderer);

        this.renderer.emit(
            'backend_data_requested', 'depth', 'DepthOverlay'
        );
    }

    public clear_cached_depth_values(): void {
        this.renderer.for_all_elements(0, 0, 0, 0, (
            _type: string, _e: Event, obj: any
        ) => {
            if (obj.data) {
                if (obj.data.depth !== undefined)
                    obj.data.depth = undefined;
                if (obj.data.depth_string !== undefined)
                    obj.data.depth_string = undefined;
            }
        });
    }

    public calculate_depth_node(
        node: SDFGNode, symbol_map: SymbolMap, depth_values: number[]
    ): number | undefined {
        const depth_string = this.depth_map[get_element_uuid(node)];
        let depth = undefined;
        if (depth_string !== undefined)
            depth = this.symbol_resolver.parse_symbol_expression(
                depth_string,
                symbol_map
            );

        node.data.depth_string = depth_string;
        node.data.depth = depth;

        if (depth !== undefined && depth > 0)
            depth_values.push(depth);

        return depth;
    }

    public calculate_depth_graph(
        g: DagreSDFG, symbol_map: SymbolMap, depth_values: number[]
    ): void {
        g.nodes().forEach(v => {
            const state = g.node(v);
            this.calculate_depth_node(state, symbol_map, depth_values);
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

                        this.calculate_depth_node(
                            node,
                            nested_symbols_map,
                            depth_values
                        );
                        this.calculate_depth_graph(
                            node.data.graph,
                            nested_symbols_map,
                            depth_values
                        );
                    } else {
                        this.calculate_depth_node(
                            node,
                            symbol_map,
                            depth_values
                        );
                    }
                });
            }
        });
    }

    public recalculate_depth_values(graph: DagreSDFG): void {
        this.heatmap_scale_center = 5;
        this.heatmap_hist_buckets = [];

        const depth_values: number[] = [];
        this.calculate_depth_graph(
            graph,
            this.symbol_resolver.get_symbol_value_map(),
            depth_values
        );

        this.update_heatmap_scale(depth_values);

        if (depth_values.length === 0)
            depth_values.push(0);
    }

    public update_depth_map(depth_map: { [uuids: string]: any }): void {
        this.depth_map = depth_map;
        this.refresh();
    }

    public refresh(): void {
        this.clear_cached_depth_values();
        const graph = this.renderer.get_graph();
        if (graph)
            this.recalculate_depth_values(graph);

        this.renderer.draw_async();
    }

    public shade_node(node: SDFGNode, ctx: CanvasRenderingContext2D): void {
        const depth = node.data.depth;
        const depth_string = node.data.depth_string;

        const mousepos = this.renderer.get_mousepos();
        if (depth_string !== undefined && mousepos &&
            node.intersect(mousepos.x, mousepos.y)) {
            // Show the computed Depth value if applicable.
            if (isNaN(depth_string) && depth !== undefined)
                this.renderer.set_tooltip(() => {
                    const tt_cont = this.renderer.get_tooltip_container();
                    if (tt_cont)
                        tt_cont.innerText = (
                            'Depth: ' + depth_string + ' (' + depth + ')'
                        );
                });
            else
                this.renderer.set_tooltip(() => {
                    const tt_cont = this.renderer.get_tooltip_container();
                    if (tt_cont)
                        tt_cont.innerText = 'Depth: ' + depth_string;
                });
        }

        if (depth === undefined) {
            // If the Depth can't be calculated, but there's an entry for this
            // node's Depth, that means that there's an unresolved symbol. Shade
            // the node grey to indicate that.
            if (depth_string !== undefined) {
                node.shade(this.renderer, ctx, 'gray');
                return;
            } else {
                return;
            }
        }

        // Only draw positive Depth.
        if (depth <= 0)
            return;

        // Calculate the severity color.
        const color = getTempColorHslString(this.get_severity_value(depth));

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
        // In that case, we draw the Depth calculated for the entire state.
        // If it's expanded or zoomed in close enough, we traverse inside.
        graph.nodes().forEach(v => {
            const state = graph.node(v);

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
                if (foreground_elem.data.depth === undefined) {
                    const depth_string = this.depth_map[
                        get_element_uuid(foreground_elem)
                    ];
                    if (depth_string) {
                        this.symbol_resolver.parse_symbol_expression(
                            depth_string,
                            this.symbol_resolver.get_symbol_value_map(),
                            true,
                            () => {
                                this.clear_cached_depth_values();
                                const graph = this.renderer.get_graph();
                                if (graph)
                                    this.recalculate_depth_values(graph);
                            }
                        );
                    }
                }
            }
        }
        return false;
    }

}
