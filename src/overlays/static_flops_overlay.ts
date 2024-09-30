// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import {
    DagreGraph,
    Point2D,
    SymbolMap,
    getGraphElementUUID,
} from '../index';
import {
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
            const node = g.node(v);
            this.calculate_flops_node(node, symbol_map, flops_values);
            if (node instanceof ConditionalBlock) {
                for (const [_, branch] of node.branches) {
                    this.calculate_flops_node(branch, symbol_map, flops_values);
                    if (branch.data.graph) {
                        this.calculate_flops_graph(
                            branch.data.graph, symbol_map, flops_values
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

    private shadeElem(
        elem: SDFGElement, ctx: CanvasRenderingContext2D
    ): void {
        const flops = elem.data.flops;
        const flops_string = elem.data.flops_string;

        const mousepos = this.renderer.get_mousepos();
        if (flops_string !== undefined && mousepos &&
            elem.intersect(mousepos.x, mousepos.y)) {
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
                elem.shade(this.renderer, ctx, 'gray');
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
        this.shadeSDFG((elem) => {
            return elem instanceof SDFGNode || elem instanceof ControlFlowBlock;
        });
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
