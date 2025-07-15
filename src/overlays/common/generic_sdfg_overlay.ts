// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { log, mean, median } from 'mathjs';
import type {
    DagreGraph,
    SDFGRenderer,
} from '../../renderer/sdfg/sdfg_renderer';
import { OverlayManager, SymbolResolver } from '../../overlay_manager';
import { SDFVSettings } from '../../utils/sdfv_settings';
import {
    ConditionalBlock,
    ControlFlowBlock,
    ControlFlowRegion,
    Edge,
    NestedSDFG,
    SDFGElement,
    SDFGNode,
    State,
} from '../../renderer/sdfg/sdfg_elements';
import { SimpleRect, OverlayType, JsonSDFG } from '../../types';

declare const vscode: any;

export class GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.BOTH;
    public readonly olClass: typeof GenericSdfgOverlay = GenericSdfgOverlay;

    protected readonly symbolResolver: SymbolResolver;
    protected readonly vscode: any;
    protected heatmapScaleCenter: number;
    protected heatmapHistBuckets: number[];
    protected readonly overlayManager: OverlayManager;

    public constructor(
        protected readonly renderer: SDFGRenderer
    ) {
        this.overlayManager = renderer.overlayManager;
        this.symbolResolver = this.overlayManager.symbolResolver;
        this.vscode = (typeof vscode !== 'undefined' && vscode) as boolean;
        this.heatmapScaleCenter = 5;
        this.heatmapHistBuckets = [];
    }

    protected shadeBlock(_block: ControlFlowBlock, ..._args: any[]): void {
        return;
    }

    protected shadeNode(_node: SDFGNode, ..._args: any[]): void {
        return;
    }

    protected shadeEdge(_edge: Edge, ..._args: any[]): void {
        return;
    }

    protected shadeGraph(
        graph: DagreGraph, ppp: number, ctx: CanvasRenderingContext2D,
        vRect: SimpleRect, predicate: (elem: SDFGElement) => boolean,
        shadeIfNestedVisible: boolean = false, ...args: any[]
    ): void {
        // Go over visible control flow blocks, skipping invisible ones.
        for (const v of graph.nodes()) {
            const block = graph.node(v) as ControlFlowBlock;

            // If the node's invisible, we skip it.
            if (this.renderer.viewportOnly && !block.intersect(
                vRect.x, vRect.y, vRect.w, vRect.h
            ))
                continue;

            const blockppp = Math.sqrt(block.width * block.height) / ppp;
            if ((this.renderer.adaptiveHiding &&
                (blockppp < SDFVSettings.get<number>('nestedLOD'))) ||
                block.attributes()?.is_collapsed) {
                // The block is collapsed or too small, so we don't need to
                // traverse its insides.
                if (predicate(block))
                    this.shadeBlock(block, ctx, args);
                continue;
            } else if (shadeIfNestedVisible && predicate(block)) {
                this.shadeBlock(block, ctx, args);
            }

            if (block instanceof State) {
                const stateGraph = block.graph;
                if (!stateGraph)
                    continue;
                for (const stateV of stateGraph.nodes()) {
                    const node = stateGraph.node(stateV) as SDFGNode;

                    // Skip the node if it's not visible.
                    if (this.renderer.viewportOnly && !node.intersect(
                        vRect.x, vRect.y, vRect.w, vRect.h
                    ))
                        continue;

                    const attrs = node.attributes();
                    if (node instanceof NestedSDFG && (
                        attrs?.sdfg as JsonSDFG | undefined
                    )?.type !== 'SDFGShell') {
                        if (shadeIfNestedVisible && predicate(node))
                            this.shadeNode(node, ctx, args);

                        if (node.graph) {
                            this.shadeGraph(
                                node.graph, ppp, ctx, vRect, predicate,
                                shadeIfNestedVisible, args
                            );
                        }
                    } else {
                        if (!this.renderer.adaptiveHiding ||
                            ppp < SDFVSettings.get<number>('nodeLOD')) {
                            if (predicate(node))
                                this.shadeNode(node, ctx, args);
                        }
                    }
                }

                if (this.olClass.type === OverlayType.EDGE ||
                    this.olClass.type === OverlayType.BOTH) {
                    for (const e of stateGraph.edges()) {
                        const edge = stateGraph.edge(e);
                        if (!edge)
                            continue;

                        // Skip if edge is invisible, or zoomed out far
                        if (this.renderer.adaptiveHiding && (!edge.intersect(
                            vRect.x, vRect.y, vRect.w, vRect.h
                        ) || ppp > SDFVSettings.get<number>('edgeLOD')))
                            continue;

                        if (predicate(edge))
                            this.shadeEdge(edge, ctx, args);
                    }
                }
            } else if (block instanceof ControlFlowRegion) {
                if (block.graph) {
                    this.shadeGraph(
                        block.graph, ppp, ctx, vRect, predicate,
                        shadeIfNestedVisible, args
                    );
                }
            } else if (block instanceof ConditionalBlock) {
                for (const [_, branch] of block.branches) {
                    if (shadeIfNestedVisible && predicate(branch))
                        this.shadeBlock(branch, ctx, args);

                    if (branch.graph) {
                        this.shadeGraph(
                            branch.graph, ppp, ctx, vRect, predicate,
                            shadeIfNestedVisible, args
                        );
                    }
                }
            }
        }

        if (this.olClass.type === OverlayType.EDGE ||
            this.olClass.type === OverlayType.BOTH) {
            for (const e of graph.edges()) {
                const edge = graph.edge(e);
                if (!edge)
                    continue;

                // Skip if edge is invisible, or zoomed out far
                if (this.renderer.adaptiveHiding && (!edge.intersect(
                    vRect.x, vRect.y, vRect.w, vRect.h
                ) || ppp > SDFVSettings.get<number>('edgeLOD')))
                    continue;

                if (predicate(edge))
                    this.shadeEdge(edge, ctx, args);
            }
        }
    }

    protected shadeSDFG(
        predicate: (elem: SDFGElement) => boolean = () => true,
        shadeIfNestedVisible: boolean = false, ...args: any[]
    ): void {
        if (!this.renderer.graph)
            return;
        this.shadeGraph(
            this.renderer.graph, this.renderer.canvasManager.pointsPerPixel,
            this.renderer.ctx, this.renderer.viewport, predicate,
            shadeIfNestedVisible, args
        );
    }

    public draw(): void {
        return;
    }

    public refresh(): void {
        return;
    }

    protected updateHeatmapScale(values: number[]): void {
        if (values.length === 0)
            return;

        switch (this.overlayManager.heatmapScalingMethod) {
            case 'hist':
                {
                    const n = this.overlayManager.heatmapScalingHistNBuckets;
                    if (n <= 1) {
                        this.heatmapHistBuckets = [...new Set(values)];
                    } else {
                        this.heatmapHistBuckets = [];
                        const minval = Math.min(...values);
                        const maxval = Math.max(...values);
                        const step = (maxval - minval) / n;
                        for (let i = 0; i < n; i++)
                            this.heatmapHistBuckets.push(minval + (i * step));
                    }
                    this.heatmapHistBuckets.sort((a, b) => {
                        return a - b;
                    });
                }
                break;
            case 'linear_interpolation':
                this.heatmapScaleCenter = (
                    Math.min(...values) + Math.max(...values)
                ) / 2;
                break;
            case 'exponential_interpolation':
                this.heatmapScaleCenter = log(
                    Math.min(...values) * Math.max(...values),
                    this.overlayManager.heatmapScalingExpBase
                );
                break;
            case 'mean':
                this.heatmapScaleCenter = mean(values);
                break;
            case 'median':
            default:
                this.heatmapScaleCenter = median(values);
                break;
        }
    }

    public getSeverityValue(val: number): number {
        let severity = 0;

        switch (this.overlayManager.heatmapScalingMethod) {
            case 'hist':
                {
                    let i;
                    for (i = 0; i < this.heatmapHistBuckets.length - 1; i++) {
                        if (val <= this.heatmapHistBuckets[i])
                            break;
                    }
                    severity = i / (this.heatmapHistBuckets.length - 1);
                }
                break;
            case 'mean':
            case 'median':
            case 'linear_interpolation':
            case 'exponential_interpolation':
            default:
                severity = (1 / (this.heatmapScaleCenter * 2)) * val;
                break;
        }

        if (severity < 0)
            severity = 0;
        if (severity > 1)
            severity = 1;

        return severity;
    }

}

export abstract class RuntimeReportOverlay extends GenericSdfgOverlay {

    protected abstract _criterium: string;

    public abstract clearRuntimeData(): void;

    public set criterium(criterium: string) {
        this._criterium = criterium;
    }

    public get criterium(): string {
        return this._criterium;
    }

}
