// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import type {
    DagreGraph,
    SDFGRenderer,
} from '../renderer/sdfg/sdfg_renderer';
import {
    ConditionalBlock,
    ControlFlowBlock,
    NestedSDFG,
    SDFGNode,
} from '../renderer/sdfg/sdfg_elements';
import { OverlayType, SymbolMap } from '../types';
import { getGraphElementUUID } from '../utils/sdfg/sdfg_utils';
import { getTempColorHslString } from '../utils/utils';
import { GenericSdfgOverlay } from './common/generic_sdfg_overlay';
import { doForAllDagreGraphElements } from '../utils/sdfg/traversal';

export class AvgParallelismOverlay extends GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.NODE;
    public readonly olClass: typeof GenericSdfgOverlay = AvgParallelismOverlay;

    private avgParallelismMap: Record<string, string | undefined> = {};

    public constructor(renderer: SDFGRenderer) {
        super(renderer);

        this.renderer.emit(
            'backend_data_requested', 'avg_parallelism', 'AvgParallelismOverlay'
        );
    }

    public clearCachedAvgParallelismValues(): void {
        if (!this.renderer.graph || !this.renderer.sdfg)
            return;
        doForAllDagreGraphElements((_group, _info, obj) => {
            if (obj.data) {
                if (obj.data.avg_parallelism !== undefined)
                    obj.data.avg_parallelism = undefined;
                if (obj.data.avg_parallelism_string !== undefined)
                    obj.data.avg_parallelism_string = undefined;
            }
        }, this.renderer.graph, this.renderer.sdfg);
    }

    public ccalculateAvgParallelismNode(
        node: SDFGNode | ControlFlowBlock, symbolMap: SymbolMap,
        avgParallelismValues: number[]
    ): number | undefined {
        const avgParaString = this.avgParallelismMap[
            getGraphElementUUID(node)
        ];
        let avgPara = undefined;
        if (avgParaString !== undefined) {
            avgPara = this.symbolResolver.parseExpression(
                avgParaString,
                symbolMap
            );
        }

        node.data ??= {};
        node.data.avg_parallelism_string = avgParaString;
        node.data.avg_parallelism = avgPara;

        if (avgPara !== undefined && avgPara > 0)
            avgParallelismValues.push(avgPara);

        return avgPara;
    }

    public calcAvgParallelismGraph(
        g: DagreGraph, symbolMap: SymbolMap, avgParallelismValues: number[]
    ): void {
        g.nodes().forEach(v => {
            const node = g.node(v) as SDFGNode | ControlFlowBlock;
            this.ccalculateAvgParallelismNode(
                node, symbolMap, avgParallelismValues
            );
            if (node instanceof ConditionalBlock) {
                for (const [_, branch] of node.branches) {
                    this.ccalculateAvgParallelismNode(
                        branch, symbolMap, avgParallelismValues
                    );
                    if (branch.graph) {
                        this.calcAvgParallelismGraph(
                            branch.graph, symbolMap,
                            avgParallelismValues
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

                            this.ccalculateAvgParallelismNode(
                                node,
                                nestedSymbolsMap,
                                avgParallelismValues
                            );
                            if (node.graph) {
                                this.calcAvgParallelismGraph(
                                    node.graph,
                                    nestedSymbolsMap,
                                    avgParallelismValues
                                );
                            }
                        } else if (node instanceof ControlFlowBlock) {
                            this.ccalculateAvgParallelismNode(
                                node,
                                symbolMap,
                                avgParallelismValues
                            );
                        }
                    });
                }
            }
        });
    }

    public recalculateAvgParallelismValues(graph: DagreGraph): void {
        this.heatmapScaleCenter = 5;
        this.heatmapHistBuckets = [];

        const avgParallelismValues: number[] = [];
        this.calcAvgParallelismGraph(
            graph, this.symbolResolver.symbolValueMap, avgParallelismValues
        );

        this.updateHeatmapScale(avgParallelismValues);

        if (avgParallelismValues.length === 0)
            avgParallelismValues.push(0);
    }

    public updateAvgParallelismMap(
        avgParallelismMap: Record<string, any>
    ): void {
        this.avgParallelismMap = avgParallelismMap;
        this.refresh();
    }

    public refresh(): void {
        this.clearCachedAvgParallelismValues();
        const graph = this.renderer.graph;
        if (graph)
            this.recalculateAvgParallelismValues(graph);

        this.renderer.drawAsync();
    }

    private shadeElem(
        elem: SDFGNode | ControlFlowBlock, ctx: CanvasRenderingContext2D
    ): void {
        const avgParallelism = elem.data?.avg_parallelism as number | undefined;
        const avgParallelismString =
            elem.data?.avg_parallelism_string as string | undefined;

        const mousepos = this.renderer.getMousePos();
        if (avgParallelismString !== undefined && mousepos &&
            elem.intersect(mousepos.x, mousepos.y)) {
            // Show the computed avg_parallelism value if applicable.
            if (avgParallelismString && isNaN(+avgParallelismString) &&
                avgParallelism !== undefined) {
                this.renderer.showTooltip(
                    mousepos.x, mousepos.y,
                    'Average Parallelism: ' + avgParallelismString +
                    ' (' + avgParallelism.toString() + ')'
                );
            } else {
                this.renderer.showTooltip(
                    mousepos.x, mousepos.y,
                    'Average Parallelism: ' + avgParallelismString
                );
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
                if (foreground_elem.data.avg_parallelism === undefined) {
                    const avg_parallelism_string = this.avgParallelismMap[
                        getGraphElementUUID(foreground_elem)
                    ];
                    if (avg_parallelism_string) {
                        this.symbolResolver.parseExpression(
                            avg_parallelism_string,
                            this.symbolResolver.get_symbol_value_map(),
                            true,
                            () => {
                                this.clearCachedAvgParallelismValues();
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
    */

}
