// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import { Point2D } from '../index';
import {
    GraphElementInfo,
    SDFGElementGroup,
    SDFGRenderer,
} from '../renderer/renderer';
import {
    SDFGNode,
    SDFGElement,
    State,
    ControlFlowBlock,
    Edge,
} from '../renderer/renderer_elements';
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

    private shadeElem(
        elem: SDFGElement, ctx: CanvasRenderingContext2D, ...args: any[]
    ): void {
        const groups: LogicalGroup[] = args[0];
        const allGroups: LogicalGroup[] = [];
        if (elem instanceof State) {
            groups.forEach(group => {
                if (group.states.includes(elem.id)) {
                    elem.shade(this.renderer, ctx, group.color, 0.3);
                    allGroups.push(group);
                }
            });
        } else {
            groups.forEach(group => {
                group.nodes.forEach(n => {
                    if (n[0] === elem.parent_id && n[1] === elem.id) {
                        elem.shade(this.renderer, ctx, group.color, 0.3);
                        allGroups.push(group);
                    }
                });
            });
        }

        const mousepos = this.renderer.get_mousepos();
        if (allGroups.length > 0 && mousepos &&
            elem.intersect(mousepos.x, mousepos.y)) {
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

    protected shadeBlock(
        block: ControlFlowBlock, ctx: CanvasRenderingContext2D, ...args: any[]
    ): void {
        this.shadeElem(block, ctx, args);
    }

    protected shadeNode(
        node: SDFGNode, ctx: CanvasRenderingContext2D, ...args: any[]
    ): void {
        this.shadeElem(node, ctx, args);
    }

    protected shadeEdge(
        edge: Edge, ctx: CanvasRenderingContext2D, ...args: any[]
    ): void {
        this.shadeElem(edge, ctx, args);
    }

    public draw(): void {
        const sdfg = this.renderer.get_sdfg();
        const sdfgGroups = sdfg.attributes.logical_groups;
        if (sdfgGroups === undefined || sdfgGroups.length === 0)
            return;

        this.shadeSDFG(() => true, true, [sdfgGroups]);
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
