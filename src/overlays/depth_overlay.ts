// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import type {
    DagreGraph,
    GraphElementInfo,
    SDFGElementGroup,
    SDFGRenderer,
} from '../renderer/renderer';
import {
    ConditionalBlock,
    ControlFlowBlock,
    Edge,
    NestedSDFG,
    SDFGElement,
    SDFGNode,
} from '../renderer/renderer_elements';
import { OverlayType, Point2D, SymbolMap } from '../types';
import { getGraphElementUUID } from '../utils/sdfg/sdfg_utils';
import { getTempColorHslString } from '../utils/utils';
import { GenericSdfgOverlay } from './generic_sdfg_overlay';

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
        this.renderer.doForAllGraphElements((_group, _info, obj: any) => {
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
        const depth_string = this.depth_map[getGraphElementUUID(node)];
        let depth = undefined;
        if (depth_string !== undefined) {
            depth = this.symbolResolver.parse_symbol_expression(
                depth_string,
                symbol_map
            );
        }

        node.data.depth_string = depth_string;
        node.data.depth = depth;

        if (depth !== undefined && depth > 0)
            depth_values.push(depth);

        return depth;
    }

    public calculate_depth_graph(
        g: DagreGraph, symbol_map: SymbolMap, depth_values: number[]
    ): void {
        g.nodes().forEach(v => {
            const node = g.node(v);
            this.calculate_depth_node(node, symbol_map, depth_values);
            if (node instanceof ConditionalBlock) {
                for (const [_, branch] of node.branches) {
                    this.calculate_depth_node(branch, symbol_map, depth_values);
                    if (branch.data.graph) {
                        this.calculate_depth_graph(
                            branch.data.graph, symbol_map, depth_values
                        );
                    }
                }
            } else {
                const state_graph = node.data.graph;
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
                                if (!(symbol in nested_symbols_map)) {
                                    nested_symbols_map[symbol] = symbol_map[
                                        symbol
                                    ];
                                }
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
            }
        });
    }

    public recalculate_depth_values(graph: DagreGraph): void {
        this.heatmap_scale_center = 5;
        this.heatmap_hist_buckets = [];

        const depth_values: number[] = [];
        this.calculate_depth_graph(
            graph,
            this.symbolResolver.get_symbol_value_map(),
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

    private shadeElem(elem: SDFGElement, ctx: CanvasRenderingContext2D): void {
        const depth = elem.data.depth;
        const depth_string = elem.data.depth_string;

        const mousepos = this.renderer.get_mousepos();
        if (depth_string !== undefined && mousepos &&
            elem.intersect(mousepos.x, mousepos.y)) {
            // Show the computed Depth value if applicable.
            if (isNaN(depth_string) && depth !== undefined) {
                this.renderer.set_tooltip(() => {
                    const tt_cont = this.renderer.get_tooltip_container();
                    if (tt_cont) {
                        tt_cont.innerText = (
                            'Depth: ' + depth_string + ' (' + depth + ')'
                        );
                    }
                });
            } else {
                this.renderer.set_tooltip(() => {
                    const tt_cont = this.renderer.get_tooltip_container();
                    if (tt_cont)
                        tt_cont.innerText = 'Depth: ' + depth_string;
                });
            }
        }

        if (depth === undefined) {
            // If the Depth can't be calculated, but there's an entry for this
            // node's Depth, that means that there's an unresolved symbol. Shade
            // the node grey to indicate that.
            if (depth_string !== undefined) {
                elem.shade(this.renderer, ctx, 'gray');
                return;
            } else {
                return;
            }
        }

        // Only draw positive Depth.
        if (depth <= 0)
            return;

        // Calculate the severity color.
        const color = getTempColorHslString(this.getSeverityValue(depth));

        elem.shade(this.renderer, ctx, color);
    }

    protected shadeNode(
        node: SDFGNode, ctx: CanvasRenderingContext2D, ...args: any[]
    ): void {
        this.shadeElem(node, ctx);
    }

    protected shadeBlock(
        block: ControlFlowBlock, ctx: CanvasRenderingContext2D, ...args: any[]
    ): void {
        this.shadeElem(block, ctx);
    }

    public draw(): void {
        this.shadeSDFG();
    }

    public on_mouse_event(
        type: string,
        _ev: Event,
        _mousepos: Point2D,
        _elements: Record<SDFGElementGroup, GraphElementInfo[]>,
        foreground_elem: SDFGElement | null,
        ends_drag: boolean
    ): boolean {
        if (type === 'click' && !ends_drag) {
            if (foreground_elem && !(foreground_elem instanceof Edge)) {
                if (foreground_elem.data.depth === undefined) {
                    const depth_string = this.depth_map[
                        getGraphElementUUID(foreground_elem)
                    ];
                    if (depth_string) {
                        this.symbolResolver.parse_symbol_expression(
                            depth_string,
                            this.symbolResolver.get_symbol_value_map(),
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
