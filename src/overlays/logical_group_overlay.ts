// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import { DagreGraph, JsonSDFG, Point2D, SimpleRect } from '../index';
import { SDFGRenderer } from '../renderer/renderer';
import {
    NestedSDFG,
    SDFGNode,
    SDFGElement,
    State,
    SDFGElementType,
} from '../renderer/renderer_elements';
import { SDFV } from '../sdfv';
import { GenericSdfgOverlay, OverlayType } from './generic_sdfg_overlay';

export type LogicalGroup = {
    name: string,
    color: string,
    nodes: [number, number][],
    states: number[],
};

export class LogicalGroupOverlay extends GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.NODE;
    public readonly olClass: typeof GenericSdfgOverlay = LogicalGroupOverlay;

    public constructor(renderer: SDFGRenderer) {
        super(renderer);

        this.refresh();
    }

    public refresh(): void {
        this.renderer.draw_async();
    }

    public shadeNode(
        node: SDFGNode, groups: LogicalGroup[], ctx: CanvasRenderingContext2D
    ): void {
        const allGroups: LogicalGroup[] = [];
        if (node instanceof State) {
            groups.forEach(group => {
                if (group.states.includes(node.id)) {
                    node.shade(this.renderer, ctx, group.color, 0.3);
                    allGroups.push(group);
                }
            });
        } else {
            groups.forEach(group => {
                group.nodes.forEach(n => {
                    if (n[0] === node.parent_id && n[1] === node.id) {
                        node.shade(this.renderer, ctx, group.color, 0.3);
                        allGroups.push(group);
                    }
                });
            });
        }

        const mousepos = this.renderer.get_mousepos();
        if (allGroups.length > 0 && mousepos &&
            node.intersect(mousepos.x, mousepos.y)) {
            // Show the corresponding group.
            this.renderer.set_tooltip(() => {
                const tt_cont = this.renderer.get_tooltip_container();
                if (tt_cont) {
                    if (allGroups.length === 1) {
                        tt_cont.innerText = 'Group: ' + allGroups[0].name;
                    } else {
                        let group_string = 'Groups: ';
                        allGroups.forEach((group, i) => {
                            group_string += group.name;
                            if (i < allGroups.length - 1)
                                group_string += ', ';
                        });
                        tt_cont.innerText = group_string;
                    }
                }
            });
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
        const sdfgGroups = sdfg.attributes.logical_groups;
        if (sdfgGroups === undefined)
            return;

        graph?.nodes().forEach(v => {
            const block = graph.node(v);

            // If the node's invisible, we skip it.
            if ((ctx as any).lod && !block.intersect(
                visibleRect.x, visibleRect.y,
                visibleRect.w, visibleRect.h
            ))
                return;

            if (((ctx as any).lod && (ppp >= SDFV.STATE_LOD ||
                block.width / ppp <= SDFV.STATE_LOD)) ||
                block.attributes().is_collapsed
            ) {
                this.shadeNode(block, sdfgGroups, ctx);
            } else {
                if (block.type() === SDFGElementType.SDFGState) {
                    const stateGraph = block.data.graph;
                    if (stateGraph) {
                        stateGraph.nodes().forEach((v: string) => {
                            const node = stateGraph.node(v);

                            // Skip the node if it's not visible.
                            if ((ctx as any).lod && !node.intersect(
                                visibleRect.x,
                                visibleRect.y, visibleRect.w, visibleRect.h
                            ))
                                return;

                            if (node.attributes().is_collapsed ||
                                ((ctx as any).lod && ppp >= SDFV.NODE_LOD)) {
                                this.shadeNode(node, sdfgGroups, ctx);
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
                                    this.shadeNode(node, sdfgGroups, ctx);
                                }
                            }
                        });
                    }
                } else {
                    this.recursivelyShadeCFG(
                        sdfg, block.data.graph, ctx, ppp, visibleRect
                    );
                }
            }
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
        _elements: SDFGElement[],
        _foreground_elem: SDFGElement | undefined,
        _ends_drag: boolean
    ): boolean {
        return false;
    }

}
