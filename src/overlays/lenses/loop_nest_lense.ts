// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import type {
    DagreGraph,
    GraphElementInfo,
    SDFGElementGroup,
    SDFGRenderer
} from '../../renderer/renderer';
import {
    ConditionalBlock,
    LoopRegion,
    SDFGElement,
    SDFGElementType
} from '../../renderer/renderer_elements';
import { JsonSDFG, JsonSDFGControlFlowRegion, OverlayType, Point2D } from '../../types';
import { GenericSdfgOverlay } from '../generic_sdfg_overlay';

type LoopEntry = {
    children: LoopEntry[],
    length: number,
    position: {
        x: number,
        y: number,
    },
    nExecs: number,
    label: string,
    linkedLoop: LoopRegion,
};

export class LoopNestLense extends GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.LENSE;
    public readonly olClass: typeof GenericSdfgOverlay = LoopNestLense;

    private static readonly loopNestLaneXOffset = -20;

    private loops: LoopEntry[] = [];

    public constructor(renderer: SDFGRenderer) {
        super(renderer);
        this.refresh();
    }

    private recursivelyConstructLoopsList(
        cfg: JsonSDFGControlFlowRegion, loopList: LoopEntry[]
    ): void {
        for (const nd of cfg.nodes) {
            if (nd.type === SDFGElementType.ConditionalBlock) {
                const cond: unknown = nd;
                for (const branch of (cond as ConditionalBlock).branches) {
                    console.log(branch[1]);
                }
            } else if (Object.hasOwn(nd, 'cfg_list_id')) {
            }
        }
    }

    private constructLoopNestGraph(graph: DagreGraph, sdfg: JsonSDFG): void {
        this.recursivelyConstructLoopsList(sdfg, this.loops);
    }

    public refresh(): void {
        this.loops = [];

        const g = this.renderer.get_graph();
        const sdfg = this.renderer.get_sdfg();
        if (g == null)
            return;

        this.constructLoopNestGraph(g, sdfg);

        this.draw();
    }

    public draw(): void {
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
