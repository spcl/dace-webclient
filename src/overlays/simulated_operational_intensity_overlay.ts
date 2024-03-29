// Copyright 2019-2022 ETH Zurich and the DaCe authors. All rights reserved.

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

export class SimulatedOperationalIntensityOverlay extends GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.NODE;
    public readonly olClass: typeof GenericSdfgOverlay = SimulatedOperationalIntensityOverlay;

    private op_in_map: { [uuids: string]: any } = {};

    public constructor(renderer: SDFGRenderer) {
        super(renderer);

        this.renderer.emit(
            'backend_data_requested', 'op_in', 'SimulatedOperationalIntensityOverlay'
        );
    }

    public clear_cached_op_in_values(): void {
        this.renderer.for_all_elements(0, 0, 0, 0, (
            _type: string, _e: Event, obj: any
        ) => {
            if (obj.data) {
                if (obj.data.op_in !== undefined)
                    obj.data.op_in = undefined;
                if (obj.data.op_in_string !== undefined)
                    obj.data.op_in_string = undefined;
            }
        });
    }

    public calculate_op_in_node(
        node: SDFGNode, symbol_map: SymbolMap, op_in_values: number[]
    ): number | undefined {
        const op_in_string = this.op_in_map[get_element_uuid(node)];
        let op_in = undefined;
        if (op_in_string !== undefined)
            op_in = this.symbol_resolver.parse_symbol_expression(
                op_in_string,
                symbol_map,
                false
            );

        node.data.op_in_string = op_in_string;
        node.data.op_in = op_in;

        if (op_in !== undefined && op_in > 0)
            op_in_values.push(op_in);

        return op_in;
    }

    public calculate_op_in_graph(
        g: DagreSDFG, symbol_map: SymbolMap, op_in_values: number[]
    ): void {
        g.nodes().forEach(v => {
            const state = g.node(v);
            this.calculate_op_in_node(state, symbol_map, op_in_values);
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

                        this.calculate_op_in_node(
                            node,
                            nested_symbols_map,
                            op_in_values
                        );
                        this.calculate_op_in_graph(
                            node.data.graph,
                            nested_symbols_map,
                            op_in_values
                        );
                    } else {
                        this.calculate_op_in_node(
                            node,
                            symbol_map,
                            op_in_values
                        );
                    }
                });
            }
        });
    }

    public recalculate_op_in_values(graph: DagreSDFG): void {
        this.heatmap_scale_center = 5;
        this.heatmap_hist_buckets = [];

        const op_in_values: number[] = [];
        this.calculate_op_in_graph(
            graph,
            this.symbol_resolver.get_symbol_value_map(),
            op_in_values
        );

        this.update_heatmap_scale(op_in_values);

        if (op_in_values.length === 0)
            op_in_values.push(0);
    }

    public update_op_in_map(op_in_map: { [uuids: string]: any }): void {
        this.op_in_map = op_in_map;
        this.refresh();
    }

    public refresh(): void {
        this.clear_cached_op_in_values();
        const graph = this.renderer.get_graph();
        if (graph)
            this.recalculate_op_in_values(graph);

        this.renderer.draw_async();
    }

    public shade_node(node: SDFGNode, ctx: CanvasRenderingContext2D): void {
        const op_in = node.data.op_in;
        const op_in_string = node.data.op_in_string;

        const mousepos = this.renderer.get_mousepos();
        if (op_in_string !== undefined && mousepos &&
            node.intersect(mousepos.x, mousepos.y)) {
            // Show the computed op_in value if applicable.
            if (isNaN(op_in_string) && op_in !== undefined)
                this.renderer.set_tooltip(() => {
                    const tt_cont = this.renderer.get_tooltip_container();
                    if (tt_cont)
                        tt_cont.innerText = (
                            'Operational Intensity: ' + op_in_string + ' (' + op_in + ')'
                        );
                });
            else
                this.renderer.set_tooltip(() => {
                    const tt_cont = this.renderer.get_tooltip_container();
                    if (tt_cont)
                        tt_cont.innerText = 'Operational Intensity: ' + op_in_string;
                });
        }

        if (op_in === undefined) {
            // If the op_in can't be calculated, but there's an entry for this
            // node's op_in, that means that there's an unresolved symbol. Shade
            // the node grey to indicate that.
            if (op_in_string !== undefined) {
                node.shade(this.renderer, ctx, 'gray');
                return;
            } else {
                return;
            }
        }

        // Only draw positive op_in.
        if (op_in <= 0)
            return;

        // Calculate the severity color.
        const color = getTempColorHslString(1 - this.get_severity_value(op_in));

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
        // In that case, we draw the op_in calculated for the entire state.
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
                if (foreground_elem.data.op_in === undefined) {
                    const op_in_string = this.op_in_map[
                        get_element_uuid(foreground_elem)
                    ];
                    if (op_in_string) {
                        this.symbol_resolver.parse_symbol_expression(
                            op_in_string,
                            this.symbol_resolver.get_symbol_value_map(),
                            true,
                            () => {
                                this.clear_cached_op_in_values();
                                const graph = this.renderer.get_graph();
                                if (graph)
                                    this.recalculate_op_in_values(graph);
                            }
                        );
                    }
                }
            }
        }
        return false;
    }

}
