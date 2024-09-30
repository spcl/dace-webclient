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

export class SimulatedOperationalIntensityOverlay extends GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.NODE;
    public readonly olClass: typeof GenericSdfgOverlay =
        SimulatedOperationalIntensityOverlay;

    private op_in_map: { [uuids: string]: any } = {};

    public constructor(renderer: SDFGRenderer) {
        super(renderer);

        this.renderer.emit(
            'backend_data_requested', 'op_in',
            'SimulatedOperationalIntensityOverlay'
        );
    }

    public clear_cached_op_in_values(): void {
        this.renderer.doForAllGraphElements((_group, _info, obj) => {
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
        const op_in_string = this.op_in_map[getGraphElementUUID(node)];
        let op_in = undefined;
        if (op_in_string !== undefined) {
            op_in = this.symbolResolver.parse_symbol_expression(
                op_in_string,
                symbol_map,
                false
            );
        }

        node.data.op_in_string = op_in_string;
        node.data.op_in = op_in;

        if (op_in !== undefined && op_in > 0)
            op_in_values.push(op_in);

        return op_in;
    }

    public calculate_op_in_graph(
        g: DagreGraph, symbol_map: SymbolMap, op_in_values: number[]
    ): void {
        g.nodes().forEach(v => {
            const node = g.node(v);
            this.calculate_op_in_node(node, symbol_map, op_in_values);
            if (node instanceof ConditionalBlock) {
                for (const [_, branch] of node.branches) {
                    this.calculate_op_in_node(branch, symbol_map, op_in_values);
                    if (branch.data.graph) {
                        this.calculate_op_in_graph(
                            branch.data.graph, symbol_map, op_in_values
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
                                node.data.node.attributes.symbol_mapping;
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
            }
        });
    }

    public recalculate_op_in_values(graph: DagreGraph): void {
        this.heatmap_scale_center = 5;
        this.heatmap_hist_buckets = [];

        const op_in_values: number[] = [];
        this.calculate_op_in_graph(
            graph,
            this.symbolResolver.get_symbol_value_map(),
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

    private shadeElem(elem: SDFGElement, ctx: CanvasRenderingContext2D): void {
        const op_in = elem.data.op_in;
        const op_in_string = elem.data.op_in_string;

        const mousepos = this.renderer.get_mousepos();
        if (op_in_string !== undefined && mousepos &&
            elem.intersect(mousepos.x, mousepos.y)) {
            // Show the computed op_in value if applicable.
            if (isNaN(op_in_string) && op_in !== undefined) {
                this.renderer.set_tooltip(() => {
                    const tt_cont = this.renderer.get_tooltip_container();
                    if (tt_cont) {
                        tt_cont.innerText = (
                            'Operational Intensity: ' + op_in_string + ' (' +
                                op_in + ')'
                        );
                    }
                });
            } else {
                this.renderer.set_tooltip(() => {
                    const tt_cont = this.renderer.get_tooltip_container();
                    if (tt_cont) {
                        tt_cont.innerText = 'Operational Intensity: ' +
                            op_in_string;
                    }
                });
            }
        }

        if (op_in === undefined) {
            // If the op_in can't be calculated, but there's an entry for this
            // node's op_in, that means that there's an unresolved symbol. Shade
            // the node grey to indicate that.
            if (op_in_string !== undefined) {
                elem.shade(this.renderer, ctx, 'gray');
                return;
            } else {
                return;
            }
        }

        // Only draw positive op_in.
        if (op_in <= 0)
            return;

        // Calculate the severity color.
        const color = getTempColorHslString(1 - this.getSeverityValue(op_in));

        elem.shade(this.renderer, ctx, color);
    }

    protected shadeBlock(
        block: ControlFlowBlock, ctx: CanvasRenderingContext2D, ...args: any[]
    ): void {
        this.shadeElem(block, ctx);
    }

    protected shadeNode(
        node: SDFGNode, ctx: CanvasRenderingContext2D, ...args: any[]
    ): void {
        this.shadeElem(node, ctx);
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
                if (foreground_elem.data.op_in === undefined) {
                    const op_in_string = this.op_in_map[
                        getGraphElementUUID(foreground_elem)
                    ];
                    if (op_in_string) {
                        this.symbolResolver.parse_symbol_expression(
                            op_in_string,
                            this.symbolResolver.get_symbol_value_map(),
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
