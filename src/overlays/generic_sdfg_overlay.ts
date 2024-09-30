// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import { log, mean, median } from 'mathjs';
import { DagreGraph, OverlayManager, Point2D, SDFVSettings, SimpleRect, SymbolResolver } from '../index';
import {
    GraphElementInfo,
    SDFGElementGroup,
    SDFGRenderer,
} from '../renderer/renderer';
import {
    ConditionalBlock,
    ControlFlowBlock,
    ControlFlowRegion,
    Edge,
    NestedSDFG,
    SDFGElement,
    SDFGNode,
    State,
} from '../renderer/renderer_elements';

declare const vscode: any;

export enum OverlayType {
    NODE,
    EDGE,
    BOTH,
}

export class GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.BOTH;
    public readonly olClass: typeof GenericSdfgOverlay = GenericSdfgOverlay;

    protected symbolResolver: SymbolResolver;
    protected vscode: any;
    protected heatmap_scale_center: number;
    protected heatmap_hist_buckets: number[];
    protected overlay_manager: OverlayManager;

    public constructor(
        protected renderer: SDFGRenderer
    ) {
        this.overlay_manager = renderer.overlayManager;
        this.symbolResolver = this.overlay_manager.get_symbol_resolver();
        this.vscode = typeof vscode !== 'undefined' && vscode;
        this.heatmap_scale_center = 5;
        this.heatmap_hist_buckets = [];
    }

    protected shadeBlock(
        block: ControlFlowBlock, ctx: CanvasRenderingContext2D, ...args: any[]
    ): void {
        return;
    }

    protected shadeNode(
        node: SDFGNode, ctx: CanvasRenderingContext2D, ...args: any[]
    ): void {
        return;
    }

    protected shadeEdge(
        edge: Edge, ctx: CanvasRenderingContext2D, ...args: any[]
    ): void {
        return;
    }

    protected shadeGraph(
        graph: DagreGraph, ppp: number, ctx: CanvasRenderingContext2D,
        vRect: SimpleRect, predicate: (elem: SDFGElement) => boolean,
        shadeIfNestedVisible: boolean = false, ...args: any[]
    ): void {
        // Go over visible control flow blocks, skipping invisible ones.
        for (const v of graph.nodes()) {
            const block: ControlFlowBlock = graph.node(v);

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
                const stateGraph = block.data.graph;
                if (!stateGraph)
                    continue;
                for (const stateV of stateGraph.nodes()) {
                    const node = stateGraph.node(stateV);

                    // Skip the node if it's not visible.
                    if (this.renderer.viewportOnly && !node.intersect(
                        vRect.x, vRect.y, vRect.w, vRect.h
                    ))
                        continue;

                    if (node instanceof NestedSDFG &&
                        node.attributes().sdfg &&
                        node.attributes().sdfg.type !== 'SDFGShell') {
                        if (shadeIfNestedVisible && predicate(node))
                            this.shadeNode(node, ctx, args);

                        this.shadeGraph(
                            node.data.graph, ppp, ctx, vRect, predicate,
                            shadeIfNestedVisible, args
                        );
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
                        const edge: Edge = stateGraph.edge(e);

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
                if (block.data.graph) {
                    this.shadeGraph(
                        block.data.graph, ppp, ctx, vRect, predicate,
                        shadeIfNestedVisible, args
                    );
                }
            } else if (block instanceof ConditionalBlock) {
                for (const [_, branch] of block.branches) {
                    if (shadeIfNestedVisible && predicate(branch))
                        this.shadeBlock(branch, ctx, args);

                    if (branch.data.graph) {
                        this.shadeGraph(
                            branch.data.graph, ppp, ctx, vRect, predicate,
                            shadeIfNestedVisible, args
                        );
                    }
                }
            }
        }

        if (this.olClass.type === OverlayType.EDGE ||
            this.olClass.type === OverlayType.BOTH) {
            for (const e of graph.edges()) {
                const edge: Edge = (graph as any).edge(e);

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
        const g = this.renderer.get_graph();
        const ppp = this.renderer.get_canvas_manager()?.points_per_pixel();
        const ctx = this.renderer.get_context();
        const vRect = this.renderer.get_visible_rect();
        if (g === null || ppp === undefined || ctx === null || vRect === null)
            return;
        this.shadeGraph(
            g, ppp, ctx, vRect, predicate, shadeIfNestedVisible, args
        );
    }

    public draw(): void {
        return;
    }

    public on_mouse_event(
        _type: string,
        _ev: MouseEvent,
        _mousepos: Point2D,
        _elements: Record<SDFGElementGroup, GraphElementInfo[]>,
        _foreground_elem: SDFGElement | null,
        _ends_drag: boolean
    ): boolean {
        return false;
    }

    public refresh(): void {
        return;
    }

    protected update_heatmap_scale(values: number[]): void {
        if (!values || values.length === 0)
            return;

        switch (this.overlay_manager.get_heatmap_scaling_method()) {
            case 'hist':
                {
                    const n = this.overlay_manager
                        .get_heatmap_scaling_hist_n_buckets();
                    if (n <= 1) {
                        this.heatmap_hist_buckets = [...new Set(values)];
                    } else {
                        this.heatmap_hist_buckets = [];
                        const minval = Math.min(...values);
                        const maxval = Math.max(...values);
                        const step = (maxval - minval) / n;
                        for (let i = 0; i < n; i++)
                            this.heatmap_hist_buckets.push(minval + (i * step));
                    }
                    this.heatmap_hist_buckets.sort((a, b) => {
                        return a - b;
                    });
                }
                break;
            case 'linear_interpolation':
                this.heatmap_scale_center = (
                    Math.min(...values) + Math.max(...values)
                ) / 2;
                break;
            case 'exponential_interpolation':
                this.heatmap_scale_center = log(
                    Math.min(...values) * Math.max(...values),
                    this.overlay_manager.get_heatmap_scaling_exp_base()
                );
                break;
            case 'mean':
                this.heatmap_scale_center = mean(values);
                break;
            case 'median':
            default:
                this.heatmap_scale_center = median(values);
                break;
        }
    }

    public getSeverityValue(val: number): number {
        let severity = 0;

        switch (this.overlay_manager.get_heatmap_scaling_method()) {
            case 'hist':
                {
                    let i;
                    for (i = 0; i < this.heatmap_hist_buckets.length - 1; i++) {
                        if (val <= this.heatmap_hist_buckets[i])
                            break;
                    }
                    severity = i / (this.heatmap_hist_buckets.length - 1);
                }
                break;
            case 'mean':
            case 'median':
            case 'linear_interpolation':
            case 'exponential_interpolation':
            default:
                severity = (1 / (this.heatmap_scale_center * 2)) * val;
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

    protected abstract criterium: string;

    public abstract clearRuntimeData(): void;

    public set_criterium(criterium: string): void {
        this.criterium = criterium;
    }

    public get_criterium(): string {
        return this.criterium;
    }

}
