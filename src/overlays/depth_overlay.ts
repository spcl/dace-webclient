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

export class DepthOverlay extends GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.NODE;
    public readonly olClass: typeof GenericSdfgOverlay = DepthOverlay;

    private depthMap: Record<string, string | undefined> = {};

    public constructor(renderer: SDFGRenderer) {
        super(renderer);

        this.renderer.emit(
            'backend_data_requested', 'depth', 'DepthOverlay'
        );
    }

    public clearCachedDepthValues(): void {
        if (!this.renderer.graph)
            return;
        doForAllDagreGraphElements((_group, _info, obj) => {
            if (obj.data) {
                if (obj.data.depth !== undefined)
                    obj.data.depth = undefined;
                if (obj.data.depth_string !== undefined)
                    obj.data.depth_string = undefined;
            }
        }, this.renderer.graph, this.renderer.sdfg);
    }

    public calcDepthNode(
        node: SDFGNode | ControlFlowBlock, symbolMap: SymbolMap,
        depthValues: number[]
    ): number | undefined {
        const nodeId = getGraphElementUUID(node);
        const depthString = this.depthMap[nodeId];
        let depth = undefined;
        if (depthString !== undefined) {
            depth = this.symbolResolver.parseExpression(
                depthString,
                symbolMap
            );
        }

        node.data ??= {};
        node.data.depth_string = depthString;
        node.data.depth = depth;

        if (depth !== undefined && depth > 0)
            depthValues.push(depth);

        return depth;
    }

    public calcDepthGraph(
        g: DagreGraph, symbolMap: SymbolMap, depthValues: number[]
    ): void {
        g.nodes().forEach(v => {
            const node = g.node(v) as SDFGNode | ControlFlowBlock;
            this.calcDepthNode(node, symbolMap, depthValues);
            if (node instanceof ConditionalBlock) {
                for (const [_, branch] of node.branches) {
                    this.calcDepthNode(branch, symbolMap, depthValues);
                    if (branch.graph) {
                        this.calcDepthGraph(
                            branch.graph, symbolMap, depthValues
                        );
                    }
                }
            } else {
                const stateGraph = node.graph;
                if (stateGraph) {
                    stateGraph.nodes().forEach((v: string) => {
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

                            this.calcDepthNode(
                                node,
                                nestedSymbolsMap,
                                depthValues
                            );
                            if (node.graph) {
                                this.calcDepthGraph(
                                    node.graph,
                                    nestedSymbolsMap,
                                    depthValues
                                );
                            }
                        } else if (node instanceof ControlFlowBlock) {
                            this.calcDepthNode(
                                node,
                                symbolMap,
                                depthValues
                            );
                        }
                    });
                }
            }
        });
    }

    public recalculateDepthValues(graph: DagreGraph): void {
        this.heatmapScaleCenter = 5;
        this.heatmapHistBuckets = [];

        const depthValues: number[] = [];
        this.calcDepthGraph(
            graph, this.symbolResolver.symbolValueMap, depthValues
        );

        this.updateHeatmapScale(depthValues);

        if (depthValues.length === 0)
            depthValues.push(0);
    }

    public updateDepthMap(depthMap: Record<string, any>): void {
        this.depthMap = depthMap;
        this.refresh();
    }

    public refresh(): void {
        this.clearCachedDepthValues();
        const graph = this.renderer.graph;
        if (graph)
            this.recalculateDepthValues(graph);

        this.renderer.drawAsync();
    }

    private shadeElem(elem: SDFGElement, ctx: CanvasRenderingContext2D): void {
        const depth = elem.data?.depth as number | undefined;
        const depthString = elem.data?.depth_string as string | undefined;

        const mousepos = this.renderer.getMousePos();
        if (depthString !== undefined && mousepos &&
            elem.intersect(mousepos.x, mousepos.y)) {
            // Show the computed Depth value if applicable.
            if (depthString && isNaN(+depthString) && depth !== undefined) {
                this.renderer.showTooltip(
                    mousepos.x, mousepos.y,
                    'Depth: ' + depthString + ' (' + depth.toString() + ')'
                );
            } else {
                this.renderer.showTooltip(
                    mousepos.x, mousepos.y, 'Depth: ' + depthString
                );
            }
        }

        if (depth === undefined) {
            // If the Depth can't be calculated, but there's an entry for this
            // node's Depth, that means that there's an unresolved symbol. Shade
            // the node grey to indicate that.
            if (depthString !== undefined) {
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
                if (foreground_elem.data.depth === undefined) {
                    const depth_string = this.depthMap[
                        getGraphElementUUID(foreground_elem)
                    ];
                    if (depth_string) {
                        this.symbolResolver.parseExpression(
                            depth_string,
                            this.symbolResolver.get_symbol_value_map(),
                            true,
                            () => {
                                this.clearCachedDepthValues();
                                const graph = this.renderer.get_graph();
                                if (graph)
                                    this.recalculateDepthValues(graph);
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
