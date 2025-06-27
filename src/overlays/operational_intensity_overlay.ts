// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import type {
    DagreGraph,
    SDFGRenderer,
} from '../renderer/sdfg/sdfg_renderer';
import {
    ConditionalBlock,
    ControlFlowBlock,
    NestedSDFG,
    SDFGElement,
    SDFGNode,
} from '../renderer/sdfg/sdfg_elements';
import { JsonSDFGMultiConnectorEdge, OverlayType, SymbolMap } from '../types';
import { getGraphElementUUID } from '../utils/sdfg/sdfg_utils';
import { getTempColorHslString } from '../utils/utils';
import { GenericSdfgOverlay } from './common/generic_sdfg_overlay';
import { doForAllDagreGraphElements } from '../utils/sdfg/traversal';

export class OperationalIntensityOverlay extends GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.NODE;
    public readonly olClass: typeof GenericSdfgOverlay =
        OperationalIntensityOverlay;

    private flopsMap: Record<string, string | undefined> = {};

    public constructor(renderer: SDFGRenderer) {
        super(renderer);

        this.renderer.emit(
            'backend_data_requested', 'flops', 'OperationalIntensityOverlay'
        );
    }

    public clearCachedValues(): void {
        if (!this.renderer.graph || !this.renderer.sdfg)
            return;
        doForAllDagreGraphElements((_group, _info, obj) => {
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
        }, this.renderer.graph, this.renderer.sdfg);
    }

    public calcOpIntNode(
        node: SDFGNode | ControlFlowBlock, symbolMap: SymbolMap,
        opIntValues: number[]
    ): number | undefined {
        if (node.parentStateId === undefined)
            return;

        const flopsString = this.flopsMap[getGraphElementUUID(node)];
        let flops = undefined;
        if (flopsString !== undefined) {
            flops = this.symbolResolver.parseExpression(
                flopsString, symbolMap
            );
        }

        node.data ??= {};
        node.data.flops_string = flopsString;
        node.data.flops = flops;

        const ioVolumes = [];
        const ioEdges = [];

        const parentBlock = node.sdfg.nodes[node.parentStateId];
        const edges = parentBlock.edges as
            JsonSDFGMultiConnectorEdge[] | undefined;
        for (const e of edges ?? []) {
            if (e.src === node.id.toString() || e.dst === node.id.toString())
                ioEdges.push(e);
        }

        for (const edge of ioEdges) {
            let volumeString = undefined;
            let volume = undefined;
            const memlet = edge.attributes?.data;
            if (!memlet)
                continue;

            if (!memlet.volume) {
                const memletAttrs = memlet.attributes;
                if (memletAttrs) {
                    volumeString = memletAttrs.volume;
                    if (volumeString !== undefined) {
                        volumeString = volumeString.replace(/\*\*/g, '^');
                        volumeString = volumeString.replace(
                            /ceiling/g, 'ceil'
                        );
                    }
                    if (volumeString !== undefined) {
                        volume = this.symbolResolver.parseExpression(
                            volumeString, symbolMap
                        );
                        memlet.volume = volume;
                    }
                }
            } else {
                volume = memlet.volume;
            }

            if (volume !== undefined && volume > 0) {
                let ioDt = '';
                if (edge.attributes?.data?.attributes?.data) {
                    const array = node.sdfg.attributes?._arrays[
                        edge.attributes.data.attributes.data
                    ];
                    ioDt = array?.attributes?.dtype ?? '';
                }
                ioVolumes.push({
                    volume: volume,
                    dtype: ioDt,
                });
            }
        }

        let opint = undefined;
        if (flops !== undefined && flops > 0) {
            let totalVolume = 0;
            for (const ioVol of ioVolumes)
                totalVolume += ioVol.volume;
            if (totalVolume > 0)
                opint = flops / totalVolume;
        }
        if (opint !== undefined && opint > 0)
            opIntValues.push(opint);

        node.data.opint = opint;
        return opint;
    }

    public calculateOpIntGraph(
        g: DagreGraph, symbolMap: SymbolMap, flopsValues: number[]
    ): void {
        g.nodes().forEach(v => {
            const node = g.node(v) as SDFGNode | ControlFlowBlock;
            this.calcOpIntNode(node, symbolMap, flopsValues);
            if (node instanceof ConditionalBlock) {
                for (const [_, branch] of node.branches) {
                    this.calcOpIntNode(branch, symbolMap, flopsValues);
                    if (branch.graph) {
                        this.calculateOpIntGraph(
                            branch.graph, symbolMap, flopsValues
                        );
                    }
                }
            } else {
                const stateGraph = node.graph;
                if (stateGraph) {
                    stateGraph.nodes().forEach(v => {
                        const node = stateGraph.node(v);
                        if (node instanceof NestedSDFG) {
                            const nestedSymbolsMap: SymbolMap = {};
                            const mapping = (
                                node.attributes()?.symbol_mapping ?? {}
                            ) as Record<string, string>;
                            // Translate the symbol mappings for the nested SDFG
                            // based on the mapping described on the node.
                            Object.keys(mapping).forEach((symbol: string) => {
                                nestedSymbolsMap[symbol] =
                                    this.symbolResolver.parseExpression(
                                        mapping[symbol],
                                        symbolMap
                                    );
                            });
                            // Merge in the parent mappings.
                            Object.keys(symbolMap).forEach((symbol) => {
                                if (!(symbol in nestedSymbolsMap)) {
                                    nestedSymbolsMap[symbol] = symbolMap[
                                        symbol
                                    ];
                                }
                            });

                            this.calcOpIntNode(
                                node,
                                nestedSymbolsMap,
                                flopsValues
                            );
                            if (node.graph) {
                                this.calculateOpIntGraph(
                                    node.graph,
                                    nestedSymbolsMap,
                                    flopsValues
                                );
                            }
                        } else if (node instanceof ControlFlowBlock) {
                            this.calcOpIntNode(
                                node,
                                symbolMap,
                                flopsValues
                            );
                        }
                    });
                }
            }
        });
    }

    public recalculateOpIntValues(graph: DagreGraph): void {
        this.heatmapScaleCenter = 5;
        this.heatmapHistBuckets = [];

        const flopsValues: number[] = [];
        this.calculateOpIntGraph(
            graph, this.symbolResolver.symbolValueMap, flopsValues
        );

        this.updateHeatmapScale(flopsValues);

        if (flopsValues.length === 0)
            flopsValues.push(0);
    }

    public updateFlopsMap(flopsMap: Record<string, any>): void {
        this.flopsMap = flopsMap;
        this.refresh();
    }

    public refresh(): void {
        this.clearCachedValues();
        const graph = this.renderer.graph;
        if (graph)
            this.recalculateOpIntValues(graph);

        this.renderer.drawAsync();
    }

    private shadeElem(elem: SDFGElement, ctx: CanvasRenderingContext2D): void {
        const opint = elem.data?.opint as number | undefined;

        const mousepos = this.renderer.getMousePos();
        if (opint !== undefined && mousepos &&
            elem.intersect(mousepos.x, mousepos.y)) {
            // Show the computed OP-INT value if applicable.
            this.renderer.showTooltip(
                mousepos.x, mousepos.y,
                'Operational Intensity: ' + opint.toString()
            );
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
        node: SDFGNode, ctx: CanvasRenderingContext2D, ..._args: any[]
    ): void {
        this.shadeElem(node, ctx);
    }

    protected shadeBlock(
        block: ControlFlowBlock, ctx: CanvasRenderingContext2D, ..._args: any[]
    ): void {
        this.shadeElem(block, ctx);
    }

    public draw(): void {
        this.shadeSDFG();
    }

    /*
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
                    const flops_string = this.flopsMap[
                        getGraphElementUUID(foreground_elem)
                    ];
                    if (flops_string) {
                        this.symbolResolver.parseExpression(
                            flops_string,
                            this.symbolResolver.get_symbol_value_map(),
                            true,
                            () => {
                                this.clearCachedValues();
                                const graph = this.renderer.get_graph();
                                if (graph)
                                    this.recalculateOpIntValues(graph);
                            }
                        );
                    }
                }
            }
        }
        return false;
    }
    */

}
