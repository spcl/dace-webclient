// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import { DagreGraph, Point2D, SimpleRect, SymbolMap } from '../index';
import {
    GraphElementInfo,
    SDFGElementGroup,
    SDFGRenderer,
} from '../renderer/renderer';
import {
    ControlFlowBlock,
    ControlFlowRegion,
    Edge,
    NestedSDFG,
    SDFGElement,
    SDFGNode,
    State,
} from '../renderer/renderer_elements';
import { SDFV } from '../sdfv';
import { getTempColorHslString } from '../utils/utils';
import { GenericSdfgOverlay, OverlayType } from './generic_sdfg_overlay';

export class MemoryVolumeOverlay extends GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.EDGE;
    public readonly olClass: typeof GenericSdfgOverlay = MemoryVolumeOverlay;

    public constructor(renderer: SDFGRenderer) {
        super(renderer);

        this.refresh();
    }

    public clearCachedVolumeValues(): void {
        this.renderer.doForAllGraphElements((_group, info, obj: any) => {
            if (obj.data) {
                if (obj.data.volume !== undefined)
                    obj.data.volume = undefined;
            }
        });
    }

    public calculateVolumeEdge(
        edge: Edge,
        symbolMap: SymbolMap,
        volumes: number[]
    ): number | undefined {
        let volumeString = undefined;
        if (edge.data && edge.data.attributes) {
            volumeString = edge.data.attributes.volume;
            if (volumeString !== undefined) {
                volumeString = volumeString.replace(/\*\*/g, '^');
                volumeString = volumeString.replace(/ceiling/g, 'ceil');
            }
        }
        let volume = undefined;
        if (volumeString !== undefined) {
            volume = this.symbolResolver.parse_symbol_expression(
                volumeString,
                symbolMap
            );
        }

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
            const block: ControlFlowBlock = g.node(v);
            if (block instanceof State) {
                const stateGraph = block.data.graph;
                if (stateGraph) {
                    stateGraph.edges().forEach((e: number) => {
                        const edge = stateGraph.edge(e);
                        if (edge instanceof Edge) {
                            this.calculateVolumeEdge(
                                edge,
                                symbolMaps,
                                volumes
                            );
                        }
                    });

                    stateGraph.nodes().forEach((v: number) => {
                        const node = stateGraph.node(v);
                        if (node instanceof NestedSDFG) {
                            const nested_symbols_map: SymbolMap = {};
                            const mapping =
                                node.data.node.attributes.symbol_mapping ?? {};
                            // Translate the symbol mappings for the nested SDFG
                            // based on the mapping described on the node.
                            Object.keys(mapping).forEach((symbol) => {
                                nested_symbols_map[symbol] =
                                    this.symbolResolver.parse_symbol_expression(
                                        mapping[symbol],
                                        symbolMaps
                                    );
                            });
                            // Merge in the parent mappings.
                            Object.keys(symbolMaps).forEach((symbol) => {
                                if (!(symbol in nested_symbols_map)) {
                                    nested_symbols_map[symbol] =
                                        symbolMaps[symbol];
                                }
                            });

                            this.calculateVolumeGraph(
                                node.data.graph,
                                nested_symbols_map,
                                volumes
                            );
                        }
                    });
                }
            } else if (block instanceof ControlFlowRegion) {
                this.calculateVolumeGraph(
                    block.data.graph, symbolMaps, volumes
                );
            }
        });
    }

    public recalculateVolumeValues(graph: DagreGraph): void {
        this.heatmap_scale_center = 5;
        this.heatmap_hist_buckets = [];

        const volume_values: number[] = [];
        this.calculateVolumeGraph(
            graph,
            this.symbolResolver.get_symbol_value_map(),
            volume_values
        );

        this.update_heatmap_scale(volume_values);

        if (volume_values.length === 0)
            volume_values.push(0);
    }

    public refresh(): void {
        this.clearCachedVolumeValues();
        const graph = this.renderer.get_graph();
        if (graph)
            this.recalculateVolumeValues(graph);

        this.renderer.draw_async();
    }

    public shadeEdge(edge: Edge, ctx: CanvasRenderingContext2D): void {
        const volume = edge.data.volume;
        if (volume !== undefined) {
            // Only draw positive volumes.
            if (volume <= 0)
                return;

            // Calculate the severity color.
            const color = getTempColorHslString(
                this.getSeverityValue(volume)
            );

            edge.shade(this.renderer, ctx, color);
        }
    }

    public recursivelyShadeCFG(
        graph: DagreGraph, ctx: CanvasRenderingContext2D, ppp: number,
        visibleRect: SimpleRect
    ): void {
        graph.nodes().forEach(v => {
            const block: ControlFlowBlock = graph.node(v);

            // If the node's invisible, we skip it.
            if (this.renderer.viewportOnly && !block.intersect(
                visibleRect.x, visibleRect.y,
                visibleRect.w, visibleRect.h
            ) || block.attributes()?.is_collapsed)
                return;

            // If we're zoomed out enough that the contents aren't visible, we
            // skip the state.
            const stateppp = Math.sqrt(block.width * block.height) / ppp;
            if (this.renderer.adaptiveHiding && (stateppp < SDFV.STATE_LOD))
                return;

            if (block instanceof State) {
                const state_graph = block.data.graph;
                if (state_graph) {
                    state_graph.nodes().forEach((v: string) => {
                        const node: SDFGNode = state_graph.node(v);

                        // Skip the node if it's not visible.
                        if (this.renderer.viewportOnly && !node.intersect(
                            visibleRect.x, visibleRect.y,
                            visibleRect.w, visibleRect.h
                        ))
                            return;

                        // If we're zoomed out enough that the node's contents
                        // aren't visible or the node is collapsed, we skip it.
                        if (node.data.node.attributes.is_collapsed ||
                            (this.renderer.adaptiveHiding &&
                             ppp > SDFV.NODE_LOD))
                            return;

                        if (node instanceof NestedSDFG &&
                            node.attributes().sdfg &&
                            node.attributes().sdfg.type !== 'SDFGShell') {
                            this.recursivelyShadeCFG(
                                node.data.graph, ctx, ppp, visibleRect
                            );
                        }
                    });

                    state_graph.edges().forEach((e: any) => {
                        const edge: Edge = state_graph.edge(e);

                        // Skip if edge is invisible, or zoomed out far
                        if (this.renderer.adaptiveHiding && (!edge.intersect(
                            visibleRect.x, visibleRect.y,
                            visibleRect.w, visibleRect.h
                        ) || ppp > SDFV.EDGE_LOD))
                            return;

                        this.shadeEdge(edge, ctx);
                    });
                }
            } else if (block instanceof ControlFlowRegion) {
                this.recursivelyShadeCFG(
                    block.data.graph, ctx, ppp, visibleRect
                );
            }
        });
    }

    public draw(): void {
        const graph = this.renderer.get_graph();
        const ppp = this.renderer.get_canvas_manager()?.points_per_pixel();
        const context = this.renderer.get_context();
        const visible_rect = this.renderer.get_visible_rect();
        if (graph && ppp !== undefined && context && visible_rect)
            this.recursivelyShadeCFG(graph, context, ppp, visible_rect);
    }

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
                        this.symbolResolver.parse_symbol_expression(
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

}
