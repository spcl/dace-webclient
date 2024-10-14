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
import { Point2D, SymbolMap } from '../types';
import { getGraphElementUUID } from '../utils/sdfg/sdfg_utils';
import { getTempColorHslString } from '../utils/utils';
import { GenericSdfgOverlay, OverlayType } from './generic_sdfg_overlay';

export class OperationalIntensityOverlay extends GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.NODE;
    public readonly olClass: typeof GenericSdfgOverlay =
        OperationalIntensityOverlay;

    private flops_map: { [uuids: string]: any } = {};

    public constructor(renderer: SDFGRenderer) {
        super(renderer);

        this.renderer.emit(
            'backend_data_requested', 'flops', 'OperationalIntensityOverlay'
        );
    }

    public clear_cached_values(): void {
        this.renderer.doForAllGraphElements((_group, _info, obj) => {
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

        const flops_string = this.flops_map[getGraphElementUUID(node)];
        let flops = undefined;
        if (flops_string !== undefined) {
            flops = this.symbolResolver.parse_symbol_expression(
                flops_string, symbol_map
            );
        }

        node.data.flops_string = flops_string;
        node.data.flops = flops;

        const io_volumes = [];
        const io_edges = [];

        const parentBlock = node.sdfg.nodes[node.parent_id];
        const edges = parentBlock ? parentBlock.edges : [];
        for (const e of edges ?? []) {
            if (e.src === node.id.toString() || e.dst === node.id.toString())
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

            if (volume_string !== undefined) {
                volume = this.symbolResolver.parse_symbol_expression(
                    volume_string, symbol_map
                );
            }

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
        g: DagreGraph, symbol_map: SymbolMap, flops_values: number[]
    ): void {
        g.nodes().forEach(v => {
            const node = g.node(v);
            this.calculate_opint_node(node, symbol_map, flops_values);
            if (node instanceof ConditionalBlock) {
                for (const [_, branch] of node.branches) {
                    this.calculate_opint_node(branch, symbol_map, flops_values);
                    if (branch.data.graph) {
                        this.calculate_opint_graph(
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
            }
        });
    }

    public recalculate_opint_values(graph: DagreGraph): void {
        this.heatmap_scale_center = 5;
        this.heatmap_hist_buckets = [];

        const flops_values: number[] = [];
        this.calculate_opint_graph(
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
        this.clear_cached_values();
        const graph = this.renderer.get_graph();
        if (graph)
            this.recalculate_opint_values(graph);

        this.renderer.draw_async();
    }

    private shadeElem(elem: SDFGElement, ctx: CanvasRenderingContext2D): void {
        const opint = elem.data.opint;

        const mousepos = this.renderer.get_mousepos();
        if (opint !== undefined && mousepos &&
            elem.intersect(mousepos.x, mousepos.y)) {
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
        const color = getTempColorHslString(this.getSeverityValue(opint));

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
