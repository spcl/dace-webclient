// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import type {
    DagreGraph,
    SDFGRenderer,
} from '../renderer/sdfg/sdfg_renderer';
import {
    ConditionalBlock,
    ControlFlowBlock,
    ControlFlowRegion,
    Edge,
    NestedSDFG,
    State,
} from '../renderer/sdfg/sdfg_elements';
import { OverlayType, SymbolMap } from '../types';
import { getTempColorHslString } from '../utils/utils';
import { GenericSdfgOverlay } from './common/generic_sdfg_overlay';
import { doForAllDagreGraphElements } from '../utils/sdfg/traversal';

export class MemoryVolumeOverlay extends GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.EDGE;
    public readonly olClass: typeof GenericSdfgOverlay = MemoryVolumeOverlay;

    public constructor(renderer: SDFGRenderer) {
        super(renderer);

        this.refresh();
    }

    public clearCachedVolumeValues(): void {
        if (!this.renderer.graph)
            return;
        doForAllDagreGraphElements((_group, info, obj) => {
            if (obj.data) {
                if (obj.data.volume !== undefined)
                    obj.data.volume = undefined;
            }
        }, this.renderer.graph, this.renderer.sdfg);
    }

    public calculateVolumeEdge(
        edge: Edge, symbolMap: SymbolMap, volumes: number[]
    ): number | undefined {
        let volumeString = undefined;
        const attrs = edge.attributes();
        if (attrs) {
            volumeString = attrs.volume as string | undefined;
            if (volumeString !== undefined) {
                volumeString = volumeString.replace(/\*\*/g, '^');
                volumeString = volumeString.replace(/ceiling/g, 'ceil');
            }
        }
        let volume = undefined;
        if (volumeString !== undefined) {
            volume = this.symbolResolver.parseExpression(
                volumeString,
                symbolMap
            );
        }

        edge.data ??= {};
        edge.data.volume = volume;

        if (volume !== undefined && volume > 0)
            volumes.push(volume);

        return volume;
    }

    public calculateVolumeGraph(
        g: DagreGraph,
        symbolMaps: SymbolMap,
        volumes: number[]
    ): void {
        g.nodes().forEach((v: string) => {
            const block = g.node(v) as ControlFlowBlock;
            if (block instanceof State) {
                const stateGraph = block.graph;
                if (stateGraph) {
                    stateGraph.edges().forEach((e) => {
                        const edge = stateGraph.edge(e);
                        if (edge instanceof Edge) {
                            this.calculateVolumeEdge(
                                edge,
                                symbolMaps,
                                volumes
                            );
                        }
                    });

                    stateGraph.nodes().forEach((v) => {
                        const node = stateGraph.node(v);
                        if (node instanceof NestedSDFG) {
                            const nestedSymbolsMap: SymbolMap = {};
                            const mapping = (
                                node.attributes()?.symbol_mapping ?? {}
                            ) as Record<string, string>;
                            // Translate the symbol mappings for the nested SDFG
                            // based on the mapping described on the node.
                            Object.keys(mapping).forEach((symbol) => {
                                nestedSymbolsMap[symbol] =
                                    this.symbolResolver.parseExpression(
                                        mapping[symbol],
                                        symbolMaps
                                    );
                            });
                            // Merge in the parent mappings.
                            Object.keys(symbolMaps).forEach((symbol) => {
                                if (!(symbol in nestedSymbolsMap)) {
                                    nestedSymbolsMap[symbol] =
                                        symbolMaps[symbol];
                                }
                            });

                            if (node.graph) {
                                this.calculateVolumeGraph(
                                    node.graph, nestedSymbolsMap, volumes
                                );
                            }
                        }
                    });
                }
            } else if (block instanceof ControlFlowRegion) {
                if (block.graph) {
                    this.calculateVolumeGraph(
                        block.graph, symbolMaps, volumes
                    );
                }
            } else if (block instanceof ConditionalBlock) {
                for (const [_, branch] of block.branches) {
                    if (branch.graph) {
                        this.calculateVolumeGraph(
                            branch.graph, symbolMaps, volumes
                        );
                    }
                }
            }
        });
    }

    public recalculateVolumeValues(graph: DagreGraph): void {
        this.heatmapScaleCenter = 5;
        this.heatmapHistBuckets = [];

        const volumeValues: number[] = [];
        this.calculateVolumeGraph(
            graph, this.symbolResolver.symbolValueMap, volumeValues
        );

        this.updateHeatmapScale(volumeValues);

        if (volumeValues.length === 0)
            volumeValues.push(0);
    }

    public refresh(): void {
        this.clearCachedVolumeValues();
        const graph = this.renderer.graph;
        if (graph)
            this.recalculateVolumeValues(graph);

        this.renderer.drawAsync();
    }

    protected shadeEdge(edge: Edge, ctx: CanvasRenderingContext2D): void {
        const volume = (edge.data?.volume ?? 0) as number;
        const color = getTempColorHslString(this.getSeverityValue(volume));
        edge.shade(this.renderer, ctx, color);
    }

    public draw(): void {
        this.shadeSDFG((elem) => {
            return elem.data?.volume !== undefined &&
                elem.data.volume as number > 0;
        });
    }

    /*
    public on_mouse_event(
        type: string,
        _ev: MouseEvent,
        _mousepos: Point2D,
        _elements: Record<SDFGElementGroup, GraphElementInfo[]>,
        foreground_elem: SDFGElement | null,
        ends_drag: boolean
    ): boolean {
        if (type === 'click' && !ends_drag) {
            if (foreground_elem && foreground_elem instanceof Edge) {
                if (foreground_elem.data.volume === undefined) {
                    if (foreground_elem.data.attributes.volume) {
                        this.symbolResolver.parseExpression(
                            foreground_elem.data.attributes.volume,
                            this.symbolResolver.get_symbol_value_map(),
                            true,
                            () => {
                                const graph = this.renderer.get_graph();
                                if (graph) {
                                    this.clearCachedVolumeValues();
                                    this.recalculateVolumeValues(graph);
                                }
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
