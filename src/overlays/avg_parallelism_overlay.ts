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

export class AvgParallelismOverlay extends GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.NODE;
    public readonly olClass: typeof GenericSdfgOverlay = AvgParallelismOverlay;

    private avg_parallelism_map: { [uuids: string]: any } = {};

    public constructor(renderer: SDFGRenderer) {
        super(renderer);

        this.renderer.emit(
            'backend_data_requested', 'avg_parallelism', 'AvgParallelismOverlay'
        );
    }

    public clear_cached_avg_parallelism_values(): void {
        this.renderer.for_all_elements(0, 0, 0, 0, (
            _type: string, _e: Event, obj: any
        ) => {
            if (obj.data) {
                if (obj.data.avg_parallelism !== undefined)
                    obj.data.avg_parallelism = undefined;
                if (obj.data.avg_parallelism_string !== undefined)
                    obj.data.avg_parallelism_string = undefined;
            }
        });
    }

    public calculate_avg_parallelism_node(
        node: SDFGNode, symbol_map: SymbolMap, avg_parallelism_values: number[]
    ): number | undefined {
        const avg_parallelism_string = this.avg_parallelism_map[get_element_uuid(node)];
        let avg_parallelism = undefined;
        if (avg_parallelism_string !== undefined)
            avg_parallelism = this.symbol_resolver.parse_symbol_expression(
                avg_parallelism_string,
                symbol_map
            );

        node.data.avg_parallelism_string = avg_parallelism_string;
        node.data.avg_parallelism = avg_parallelism;

        if (avg_parallelism !== undefined && avg_parallelism > 0)
            avg_parallelism_values.push(avg_parallelism);

        return avg_parallelism;
    }

    public calculate_avg_parallelism_graph(
        g: DagreSDFG, symbol_map: SymbolMap, avg_parallelism_values: number[]
    ): void {
        g.nodes().forEach(v => {
            const state = g.node(v);
            this.calculate_avg_parallelism_node(state, symbol_map, avg_parallelism_values);
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

                        this.calculate_avg_parallelism_node(
                            node,
                            nested_symbols_map,
                            avg_parallelism_values
                        );
                        this.calculate_avg_parallelism_graph(
                            node.data.graph,
                            nested_symbols_map,
                            avg_parallelism_values
                        );
                    } else {
                        this.calculate_avg_parallelism_node(
                            node,
                            symbol_map,
                            avg_parallelism_values
                        );
                    }
                });
            }
        });
    }

    public recalculate_avg_parallelism_values(graph: DagreSDFG): void {
        this.heatmap_scale_center = 5;
        this.heatmap_hist_buckets = [];

        const avg_parallelism_values: number[] = [];
        this.calculate_avg_parallelism_graph(
            graph,
            this.symbol_resolver.get_symbol_value_map(),
            avg_parallelism_values
        );

        this.update_heatmap_scale(avg_parallelism_values);

        if (avg_parallelism_values.length === 0)
            avg_parallelism_values.push(0);
    }

    public update_avg_parallelism_map(avg_parallelism_map: { [uuids: string]: any }): void {
        this.avg_parallelism_map = avg_parallelism_map;
        this.refresh();
    }

    public refresh(): void {
        this.clear_cached_avg_parallelism_values();
        const graph = this.renderer.get_graph();
        if (graph)
            this.recalculate_avg_parallelism_values(graph);

        this.renderer.draw_async();
    }

    public shade_node(node: SDFGNode, ctx: CanvasRenderingContext2D): void {
        const avg_parallelism = node.data.avg_parallelism;
        const avg_parallelism_string = node.data.avg_parallelism_string;

        const mousepos = this.renderer.get_mousepos();
        if (avg_parallelism_string !== undefined && mousepos &&
            node.intersect(mousepos.x, mousepos.y)) {
            // Show the computed avg_parallelism value if applicable.
            if (isNaN(avg_parallelism_string) && avg_parallelism !== undefined)
                this.renderer.set_tooltip(() => {
                    const tt_cont = this.renderer.get_tooltip_container();
                    if (tt_cont)
                        tt_cont.innerText = (
                            'Average Parallelism: ' + avg_parallelism_string + ' (' + avg_parallelism + ')'
                        );
                });
            else
                this.renderer.set_tooltip(() => {
                    const tt_cont = this.renderer.get_tooltip_container();
                    if (tt_cont)
                        tt_cont.innerText = 'Average Parallelism: ' + avg_parallelism_string;
                });
        }

        if (avg_parallelism === undefined) {
            // If the avg_parallelism can't be calculated, but there's an entry for this
            // node's avg_parallelism, that means that there's an unresolved symbol. Shade
            // the node grey to indicate that.
            if (avg_parallelism_string !== undefined) {
                node.shade(this.renderer, ctx, 'gray');
                return;
            } else {
                return;
            }
        }

        // Only draw positive avg_parallelism.
        if (avg_parallelism <= 0)
            return;

        // Calculate the severity color.
        const color = getTempColorHslString(1 - this.get_severity_value(avg_parallelism));

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
        // In that case, we draw the avg_parallelism calculated for the entire state.
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
                if (foreground_elem.data.avg_parallelism === undefined) {
                    const avg_parallelism_string = this.avg_parallelism_map[
                        get_element_uuid(foreground_elem)
                    ];
                    if (avg_parallelism_string) {
                        this.symbol_resolver.parse_symbol_expression(
                            avg_parallelism_string,
                            this.symbol_resolver.get_symbol_value_map(),
                            true,
                            () => {
                                this.clear_cached_avg_parallelism_values();
                                const graph = this.renderer.get_graph();
                                if (graph)
                                    this.recalculate_avg_parallelism_values(graph);
                            }
                        );
                    }
                }
            }
        }
        return false;
    }

}
