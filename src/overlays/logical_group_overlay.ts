// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import type {
    SDFGRenderer,
} from '../renderer/sdfg/sdfg_renderer';
import {
    SDFGNode,
    SDFGElement,
    State,
    ControlFlowBlock,
    Edge,
} from '../renderer/sdfg/sdfg_elements';
import { OverlayType } from '../types';
import { GenericSdfgOverlay } from './common/generic_sdfg_overlay';


export interface LogicalGroup {
    name: string;
    color: string;
    nodes: [number, number][];
    states: number[];
}

export class LogicalGroupOverlay extends GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.NODE;
    public readonly olClass: typeof GenericSdfgOverlay = LogicalGroupOverlay;

    public constructor(renderer: SDFGRenderer) {
        super(renderer);

        this.refresh();
    }

    public refresh(): void {
        this.renderer.drawAsync();
    }

    private shadeElem(elem: SDFGElement, ...args: any[]): void {
        const groups = args[0] as LogicalGroup[];
        const allGroups: LogicalGroup[] = [];
        if (elem instanceof State) {
            groups.forEach(group => {
                if (group.states.includes(elem.id)) {
                    elem.shade(group.color, 0.3);
                    allGroups.push(group);
                }
            });
        } else {
            groups.forEach(group => {
                group.nodes.forEach(n => {
                    if (n[0] === elem.parentStateId && n[1] === elem.id) {
                        elem.shade(group.color, 0.3);
                        allGroups.push(group);
                    }
                });
            });
        }

        const mousepos = this.renderer.getMousePos();
        if (allGroups.length > 0 && mousepos &&
            elem.intersect(mousepos.x, mousepos.y)) {
            this.renderer.showTooltip(
                mousepos.x, mousepos.y,
                allGroups.length === 1 ?
                    'Group: ' + allGroups[0].name :
                    'Groups: ' + allGroups.map(g => g.name).join(', ')
            );
        }
    }

    protected shadeBlock(block: ControlFlowBlock, ...args: any[]): void {
        this.shadeElem(block, args);
    }

    protected shadeNode(node: SDFGNode, ...args: any[]): void {
        this.shadeElem(node, args);
    }

    protected shadeEdge(edge: Edge, ...args: any[]): void {
        this.shadeElem(edge, args);
    }

    public draw(): void {
        const sdfg = this.renderer.sdfg;
        const sdfgGroups = sdfg?.attributes?.logical_groups;
        const nGroups = (sdfgGroups as { length?: number } | undefined)?.length;
        if (sdfgGroups === undefined || nGroups === 0)
            return;

        this.shadeSDFG(() => true, true, [sdfgGroups]);
    }

}
