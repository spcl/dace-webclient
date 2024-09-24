// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import {
    DagreGraph,
    JsonSDFG,
    Point2D,
    SDFVSettings,
    SimpleRect,
} from '../index';
import {
    GraphElementInfo,
    SDFGElementGroup,
    SDFGRenderer,
} from '../renderer/renderer';
import {
    NestedSDFG,
    SDFGNode,
    SDFGElement,
    SDFGElementType,
    Edge,
} from '../renderer/renderer_elements';
import { DiffMap } from '../sdfg_diff_viewer';
import { GenericSdfgOverlay, OverlayType } from './generic_sdfg_overlay';

export class DiffOverlay extends GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.BOTH;
    public readonly olClass: typeof GenericSdfgOverlay = DiffOverlay;

    private readonly CHANGED_COLOR = 'orange';
    private readonly ADDED_COLOR = 'green';
    private readonly REMOVED_COLOR = 'red';

    public constructor(
        renderer: SDFGRenderer,
        private readonly diffMap?: DiffMap
    ) {
        super(renderer);

        this.refresh();
    }

    public refresh(): void {
        this.renderer.draw_async();
    }

    public shadeElem(
        elem: Edge | SDFGNode, ctx: CanvasRenderingContext2D
    ): void {
        if (this.diffMap?.addedKeys.has(elem.guid())) {
            elem.shade(this.renderer, ctx, this.renderer.getCssProperty(
                '--color-diff-added'
            ), 1);
        } else if (this.diffMap?.removedKeys.has(elem.guid())) {
            elem.shade(this.renderer, ctx, this.renderer.getCssProperty(
                '--color-diff-removed'
            ), 1);
        } else if (this.diffMap?.changedKeys.has(elem.guid())) {
            elem.shade(this.renderer, ctx, this.renderer.getCssProperty(
                '--color-diff-changed'
            ), 1);
        }
    }

    public recursivelyShadeCFG(
        sdfg: JsonSDFG, graph: DagreGraph, ctx: CanvasRenderingContext2D,
        ppp: number, visibleRect: SimpleRect
    ): void {
        // First go over visible states, skipping invisible ones. We only draw
        // something if the state is collapsed or we're zoomed out far enough.
        // In that case, we overlay the correct grouping color(s).
        // If it's expanded or zoomed in close enough, we traverse inside.
        if (!graph)
            return;

        graph?.nodes().forEach(v => {
            const block = graph.node(v);

            // If the node's invisible, we skip it.
            if (this.renderer.viewportOnly && !block.intersect(
                visibleRect.x, visibleRect.y,
                visibleRect.w, visibleRect.h
            ))
                return;

            const blockppp = Math.sqrt(block.width * block.height) / ppp;
            if ((this.renderer.adaptiveHiding &&
                (blockppp < SDFVSettings.get<number>('nestedLOD'))) ||
                block.attributes().is_collapsed
            ) {
                this.shadeElem(block, ctx);
            } else {
                if (block.type() === SDFGElementType.SDFGState) {
                    const stateGraph = block.data.graph;
                    stateGraph?.nodes().forEach((v: string) => {
                        const node = stateGraph.node(v);

                        // Skip the node if it's not visible.
                        if (this.renderer.viewportOnly && !node.intersect(
                            visibleRect.x,
                            visibleRect.y, visibleRect.w, visibleRect.h
                        ))
                            return;

                        if (node.attributes().is_collapsed ||
                            (this.renderer.adaptiveHiding &&
                                ppp > SDFVSettings.get<number>('nodeLOD'))) {
                            this.shadeElem(node, ctx);
                        } else {
                            if (node instanceof NestedSDFG &&
                                node.attributes().sdfg &&
                                node.attributes().sdfg.type !== 'SDFGShell'
                            ) {
                                this.recursivelyShadeCFG(
                                    node.data.node.attributes.sdfg,
                                    node.data.graph, ctx, ppp, visibleRect
                                );
                            } else {
                                this.shadeElem(node, ctx);
                            }
                        }
                    });

                    stateGraph?.edges().forEach((v: any) => {
                        const edge = stateGraph.edge(v);

                        // Skip if edge is invisible, or zoomed out far
                        if (this.renderer.adaptiveHiding && (!edge.intersect(
                            visibleRect.x, visibleRect.y,
                            visibleRect.w, visibleRect.h
                        ) || ppp > SDFVSettings.get<number>('edgeLOD')))
                            return;

                        this.shadeElem(edge, ctx);
                    });
                } else {
                    this.recursivelyShadeCFG(
                        sdfg, block.data.graph, ctx, ppp, visibleRect
                    );
                }
            }
        });

        graph?.edges().forEach((v: any) => {
            const edge = graph.edge(v) as Edge;

            // Skip if edge is invisible, or zoomed out far
            if (this.renderer.adaptiveHiding && (!edge.intersect(
                visibleRect.x, visibleRect.y,
                visibleRect.w, visibleRect.h
            ) || ppp > SDFVSettings.get<number>('edgeLOD')))
                return;

            this.shadeElem(edge, ctx);
        });
    }

    public draw(): void {
        const sdfg = this.renderer.get_sdfg();
        const graph = this.renderer.get_graph();
        const ppp = this.renderer.get_canvas_manager()?.points_per_pixel();
        const context = this.renderer.get_context();
        const visible_rect = this.renderer.get_visible_rect();
        if (graph && ppp !== undefined && context && visible_rect) {
            this.recursivelyShadeCFG(
                sdfg, graph, context, ppp, visible_rect
            );
        }
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

}
