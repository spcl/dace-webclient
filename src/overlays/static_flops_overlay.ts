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
import { OverlayType, SymbolMap } from '../types';
import { getGraphElementUUID } from '../utils/sdfg/sdfg_utils';
import { getTempColorHslString } from '../utils/utils';
import { GenericSdfgOverlay } from './common/generic_sdfg_overlay';
import { doForAllDagreGraphElements } from '../utils/sdfg/traversal';

export class StaticFlopsOverlay extends GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.NODE;
    public readonly olClass: typeof GenericSdfgOverlay = StaticFlopsOverlay;

    private flopsMap: Record<string, string | undefined> = {};

    public constructor(renderer: SDFGRenderer) {
        super(renderer);

        this.renderer.emit(
            'backend_data_requested', 'flops', 'StaticFlopsOverlay'
        );
    }

    public clearCachedFlopsValues(): void {
        if (!this.renderer.graph || !this.renderer.sdfg)
            return;

        doForAllDagreGraphElements((_group, _info, obj) => {
            if (obj.data) {
                if (obj.data.flops !== undefined)
                    obj.data.flops = undefined;
                if (obj.data.flops_string !== undefined)
                    obj.data.flops_string = undefined;
            }
        }, this.renderer.graph, this.renderer.sdfg);
    }

    public calcFlopsForNode(
        node: SDFGNode | ControlFlowBlock, symbolMap: SymbolMap,
        flopsValues: number[]
    ): number | undefined {
        const nodeId = getGraphElementUUID(node);
        const flopsString = this.flopsMap[nodeId];
        let flops = undefined;
        if (flopsString !== undefined) {
            flops = this.symbolResolver.parseExpression(
                flopsString,
                symbolMap
            );
        }

        node.data ??= {};
        node.data.flops_string = flopsString;
        node.data.flops = flops;

        if (flops !== undefined && flops > 0)
            flopsValues.push(flops);

        return flops;
    }

    public calcFlopsForGraph(
        g: DagreGraph, symbolMap: SymbolMap, flopsValue: number[]
    ): void {
        g.nodes().forEach(v => {
            const node = g.node(v) as SDFGNode | ControlFlowBlock;
            this.calcFlopsForNode(node, symbolMap, flopsValue);
            if (node instanceof ConditionalBlock) {
                for (const [_, branch] of node.branches) {
                    this.calcFlopsForNode(branch, symbolMap, flopsValue);
                    if (branch.graph) {
                        this.calcFlopsForGraph(
                            branch.graph, symbolMap, flopsValue
                        );
                    }
                }
            } else {
                const stateGraph = node.graph;
                if (stateGraph) {
                    stateGraph.nodes().forEach((v: string) => {
                        const node = stateGraph.node(v) as SDFGNode;
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

                            this.calcFlopsForNode(
                                node,
                                nestedSymbolsMap,
                                flopsValue
                            );
                            if (node.graph) {
                                this.calcFlopsForGraph(
                                    node.graph,
                                    nestedSymbolsMap,
                                    flopsValue
                                );
                            }
                        } else {
                            this.calcFlopsForNode(
                                node,
                                symbolMap,
                                flopsValue
                            );
                        }
                    });
                }
            }
        });
    }

    public recalculateFlopsValues(graph: DagreGraph): void {
        this.heatmapScaleCenter = 5;
        this.heatmapHistBuckets = [];

        const flopsValues: number[] = [];
        this.calcFlopsForGraph(
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
        this.clearCachedFlopsValues();
        const graph = this.renderer.graph;
        if (graph)
            this.recalculateFlopsValues(graph);

        this.renderer.drawAsync();
    }

    private shadeElem(
        elem: SDFGElement, ctx: CanvasRenderingContext2D
    ): void {
        const flops = elem.data?.flops as number | undefined;
        const flopsString = elem.data?.flops_string as string | undefined;

        const mousepos = this.renderer.getMousePos();
        if (flopsString !== undefined && mousepos &&
            elem.intersect(mousepos.x, mousepos.y)) {
            // Show the computed FLOPS value if applicable.
            if (flopsString && isNaN(+flopsString) &&
                flops !== undefined) {
                this.renderer.showTooltip(
                    mousepos.x, mousepos.y,
                    'FLOPS: ' + flopsString + ' (' + flops.toString() + ')'
                );
            } else {
                this.renderer.showTooltip(
                    mousepos.x, mousepos.y, 'FLOPS: ' + flopsString
                );
            }
        }

        if (flops === undefined) {
            // If the FLOPS can't be calculated, but there's an entry for this
            // node's FLOPS, that means that there's an unresolved symbol. Shade
            // the node grey to indicate that.
            if (flopsString !== undefined) {
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
        this.shadeSDFG((elem) => {
            return elem instanceof SDFGNode || elem instanceof ControlFlowBlock;
        });
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
                                this.clearCachedFlopsValues();
                                const graph = this.renderer.get_graph();
                                if (graph)
                                    this.recalculateFlopsValues(graph);
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
