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
        this.renderer.doForAllGraphElements((_group, _info, obj) => {
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
        const avg_parallelism_string = this.avg_parallelism_map[
            getGraphElementUUID(node)
        ];
        let avg_parallelism = undefined;
        if (avg_parallelism_string !== undefined) {
            avg_parallelism = this.symbolResolver.parse_symbol_expression(
                avg_parallelism_string,
                symbol_map
            );
        }

        node.data.avg_parallelism_string = avg_parallelism_string;
        node.data.avg_parallelism = avg_parallelism;

        if (avg_parallelism !== undefined && avg_parallelism > 0)
            avg_parallelism_values.push(avg_parallelism);

        return avg_parallelism;
    }

    public calculate_avg_parallelism_graph(
        g: DagreGraph, symbol_map: SymbolMap, avg_parallelism_values: number[]
    ): void {
        g.nodes().forEach(v => {
            const node = g.node(v);
            this.calculate_avg_parallelism_node(
                node, symbol_map, avg_parallelism_values
            );
            if (node instanceof ConditionalBlock) {
                for (const [_, branch] of node.branches) {
                    this.calculate_avg_parallelism_node(
                        branch, symbol_map, avg_parallelism_values
                    );
                    if (branch.data.graph) {
                        this.calculate_avg_parallelism_graph(
                            branch.data.graph, symbol_map,
                            avg_parallelism_values
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
            }
        });
    }

    public recalculateAvgParallelismValues(graph: DagreGraph): void {
        this.heatmap_scale_center = 5;
        this.heatmap_hist_buckets = [];

        const avg_parallelism_values: number[] = [];
        this.calculate_avg_parallelism_graph(
            graph,
            this.symbolResolver.get_symbol_value_map(),
            avg_parallelism_values
        );

        this.update_heatmap_scale(avg_parallelism_values);

        if (avg_parallelism_values.length === 0)
            avg_parallelism_values.push(0);
    }

    public update_avg_parallelism_map(
        avg_parallelism_map: { [uuids: string]: any }
    ): void {
        this.avg_parallelism_map = avg_parallelism_map;
        this.refresh();
    }

    public refresh(): void {
        this.clear_cached_avg_parallelism_values();
        const graph = this.renderer.get_graph();
        if (graph)
            this.recalculateAvgParallelismValues(graph);

        this.renderer.draw_async();
    }

    private shadeElem(elem: SDFGNode, ctx: CanvasRenderingContext2D): void {
        const avgParallelism = elem.data.avg_parallelism;
        const avgParallelismString = elem.data.avg_parallelism_string;

        const mousepos = this.renderer.get_mousepos();
        if (avgParallelismString !== undefined && mousepos &&
            elem.intersect(mousepos.x, mousepos.y)) {
            // Show the computed avg_parallelism value if applicable.
            if (isNaN(avgParallelismString) &&
                avgParallelism !== undefined) {
                this.renderer.set_tooltip(() => {
                    const tt_cont = this.renderer.get_tooltip_container();
                    if (tt_cont) {
                        tt_cont.innerText = (
                            'Average Parallelism: ' + avgParallelismString +
                            ' (' + avgParallelism + ')'
                        );
                    }
                });
            } else {
                this.renderer.set_tooltip(() => {
                    const ttCont = this.renderer.get_tooltip_container();
                    if (ttCont) {
                        ttCont.innerText = 'Average Parallelism: ' +
                            avgParallelismString;
                    }
                });
            }
        }

        if (avgParallelism === undefined) {
            // If the avg_parallelism can't be calculated, but there's an entry
            // for this node's avg_parallelism, that means that there's an
            // unresolved symbol. Shade the node grey to indicate that.
            if (avgParallelismString !== undefined) {
                elem.shade(this.renderer, ctx, 'gray');
                return;
            } else {
                return;
            }
        }

        // Only draw positive avg_parallelism.
        if (avgParallelism <= 0)
            return;

        // Calculate the severity color.
        const color = getTempColorHslString(
            1 - this.getSeverityValue(avgParallelism)
        );

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
                if (foreground_elem.data.avg_parallelism === undefined) {
                    const avg_parallelism_string = this.avg_parallelism_map[
                        getGraphElementUUID(foreground_elem)
                    ];
                    if (avg_parallelism_string) {
                        this.symbolResolver.parse_symbol_expression(
                            avg_parallelism_string,
                            this.symbolResolver.get_symbol_value_map(),
                            true,
                            () => {
                                this.clear_cached_avg_parallelism_values();
                                const graph = this.renderer.get_graph();
                                if (graph)
                                    this.recalculateAvgParallelismValues(graph);
                            }
                        );
                    }
                }
            }
        }
        return false;
    }

}
