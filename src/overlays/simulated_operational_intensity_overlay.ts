// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import type {
    DagreGraph,
    SDFGRenderer,
} from '../renderer/sdfg/sdfg_renderer';
import {
    ConditionalBlock,
    ControlFlowBlock,
    Edge,
    NestedSDFG,
    SDFGElement,
    SDFGNode,
} from '../renderer/sdfg/sdfg_elements';
import { OverlayType, SymbolMap } from '../types';
import { getGraphElementUUID } from '../utils/sdfg/sdfg_utils';
import { getTempColorHslString } from '../utils/utils';
import { GenericSdfgOverlay } from './common/generic_sdfg_overlay';
import { doForAllDagreGraphElements } from '../utils/sdfg/traversal';


export class SimulatedOperationalIntensityOverlay extends GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.NODE;
    public readonly olClass: typeof GenericSdfgOverlay =
        SimulatedOperationalIntensityOverlay;

    private opIntMap: Record<string, string | undefined> = {};

    public constructor(renderer: SDFGRenderer) {
        super(renderer);

        this.renderer.on(
            'selection_changed', this.onSelectionChanged.bind(this)
        );

        this.renderer.emit(
            'backend_data_requested', 'op_in',
            'SimulatedOperationalIntensityOverlay'
        );
    }

    public destroy(): void {
        this.renderer.off(
            'selection_changed', this.onSelectionChanged.bind(this)
        );
    }

    public clearCachedOpIntValues(): void {
        if (!this.renderer.graph || !this.renderer.sdfg)
            return;
        doForAllDagreGraphElements((_group, _info, obj) => {
            if (obj.data) {
                if (obj.data.op_in !== undefined)
                    obj.data.op_in = undefined;
                if (obj.data.op_in_string !== undefined)
                    obj.data.op_in_string = undefined;
            }
        }, this.renderer.graph, this.renderer.sdfg);
    }

    public calculateOpIntNode(
        node: SDFGNode | ControlFlowBlock, symbolMap: SymbolMap,
        opIntValues: number[]
    ): number | undefined {
        const opIntString = this.opIntMap[getGraphElementUUID(node)];
        let opInt = undefined;
        if (opIntString !== undefined) {
            opInt = this.symbolResolver.parseExpression(
                opIntString,
                symbolMap,
                false
            );
        }

        node.data ??= {};
        node.data.op_in_string = opIntString;
        node.data.op_in = opInt;

        if (opInt !== undefined && opInt > 0)
            opIntValues.push(opInt);

        return opInt;
    }

    public calculateOpIntGraph(
        g: DagreGraph, symbolMap: SymbolMap, opIntValues: number[]
    ): void {
        g.nodes().forEach(v => {
            const node = g.node(v);
            if (!node)
                return;
            this.calculateOpIntNode(node, symbolMap, opIntValues);
            if (node instanceof ConditionalBlock) {
                for (const [_, branch] of node.branches) {
                    this.calculateOpIntNode(branch, symbolMap, opIntValues);
                    if (branch.graph) {
                        this.calculateOpIntGraph(
                            branch.graph, symbolMap, opIntValues
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
                                node.attributes()?.symbol_mapping
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
                                    nestedSymbolsMap[symbol] =
                                        symbolMap[symbol];
                                }
                            });

                            this.calculateOpIntNode(
                                node,
                                nestedSymbolsMap,
                                opIntValues
                            );
                            if (node.graph) {
                                this.calculateOpIntGraph(
                                    node.graph,
                                    nestedSymbolsMap,
                                    opIntValues
                                );
                            }
                        } else if (node instanceof ControlFlowBlock) {
                            this.calculateOpIntNode(
                                node,
                                symbolMap,
                                opIntValues
                            );
                        }
                    });
                }
            }
        });
    }

    public recalcculateOpIntValues(graph: DagreGraph): void {
        this.heatmapScaleCenter = 5;
        this.heatmapHistBuckets = [];

        const opIntValues: number[] = [];
        this.calculateOpIntGraph(
            graph, this.symbolResolver.symbolValueMap, opIntValues
        );

        this.updateHeatmapScale(opIntValues);

        if (opIntValues.length === 0)
            opIntValues.push(0);
    }

    public updateOpIntMap(opIntMap: Record<string, any>): void {
        this.opIntMap = opIntMap;
        this.refresh();
    }

    public refresh(): void {
        this.clearCachedOpIntValues();
        const graph = this.renderer.graph;
        if (graph)
            this.recalcculateOpIntValues(graph);

        this.renderer.drawAsync();
    }

    private shadeElem(elem: SDFGElement): void {
        const opInt = elem.data?.op_in as number | undefined;
        const opIntString = elem.data?.op_in_string as string | undefined;

        const mousepos = this.renderer.getMousePos();
        if (opIntString !== undefined && mousepos &&
            elem.intersect(mousepos.x, mousepos.y)) {
            // Show the computed op_in value if applicable.
            if (isNaN(+opIntString) && opInt !== undefined) {
                this.renderer.showTooltip(
                    mousepos.x, mousepos.y,
                    'Operational Intensity: ' + opIntString + ' (' +
                        opInt.toString() + ')'
                );
            } else {
                this.renderer.showTooltip(
                    mousepos.x, mousepos.y,
                    'Operational Intensity: ' + opIntString
                );
            }
        }

        if (opInt === undefined) {
            // If the op_in can't be calculated, but there's an entry for this
            // node's op_in, that means that there's an unresolved symbol. Shade
            // the node grey to indicate that.
            if (opIntString !== undefined) {
                elem.shade('gray');
                return;
            } else {
                return;
            }
        }

        // Only draw positive op_in.
        if (opInt <= 0)
            return;

        // Calculate the severity color.
        const color = getTempColorHslString(1 - this.getSeverityValue(opInt));

        elem.shade(color);
    }

    protected shadeBlock(block: ControlFlowBlock, ..._args: any[]): void {
        this.shadeElem(block);
    }

    protected shadeNode(node: SDFGNode, ..._args: any[]): void {
        this.shadeElem(node);
    }

    public draw(): void {
        this.shadeSDFG();
    }

    protected onSelectionChanged(_multiSelectionChanged: boolean): void {
        if (this.renderer.selectedRenderables.size === 1) {
            const fgElem = Array.from(this.renderer.selectedRenderables)[0];
            if (!(fgElem instanceof Edge)) {
                if (fgElem.jsonData?.op_in === undefined) {
                    const opIntString = this.opIntMap[
                        getGraphElementUUID(fgElem)
                    ];
                    if (opIntString) {
                        this.symbolResolver.parseExpression(
                            opIntString,
                            this.symbolResolver.symbolValueMap,
                            true,
                            () => {
                                this.clearCachedOpIntValues();
                                const graph = this.renderer.graph;
                                if (graph)
                                    this.recalcculateOpIntValues(graph);
                            }
                        );
                    }
                }
            }
        }
    }

}
