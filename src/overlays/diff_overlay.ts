// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import type {
    GraphElementInfo,
    SDFGElementGroup,
    SDFGRenderer,
} from '../renderer/renderer';
import {
    SDFGNode,
    SDFGElement,
    Edge,
    ControlFlowBlock,
} from '../renderer/renderer_elements';
import { DiffMap } from '../sdfg_diff_viewer';
import { OverlayType, Point2D } from '../types';
import { GenericSdfgOverlay } from './generic_sdfg_overlay';

export class DiffOverlay extends GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.BOTH;
    public readonly olClass: typeof GenericSdfgOverlay = DiffOverlay;

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
        elem: SDFGElement, ctx: CanvasRenderingContext2D
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

    protected shadeBlock(
        block: ControlFlowBlock, ctx: CanvasRenderingContext2D, ...args: any[]
    ): void {
        this.shadeElem(block, ctx);
    }

    protected shadeNode(
        node: SDFGNode, ctx: CanvasRenderingContext2D, ...args: any[]
    ): void {
        this.shadeElem(node, ctx);
    }

    protected shadeEdge(
        edge: Edge, ctx: CanvasRenderingContext2D, ...args: any[]
    ): void {
        this.shadeElem(edge, ctx);
    }

    public draw(): void {
        this.shadeSDFG();
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
