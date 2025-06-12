// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import type {
    SDFGRenderer,
} from '../renderer/sdfg/sdfg_renderer';
import {
    SDFGNode,
    SDFGElement,
    Edge,
    ControlFlowBlock,
} from '../renderer/sdfg/sdfg_elements';
import { DiffMap } from '../sdfg_diff_viewer';
import { OverlayType } from '../types';
import { GenericSdfgOverlay } from './common/generic_sdfg_overlay';

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
        this.renderer.drawAsync();
    }

    public shadeElem(
        elem: SDFGElement, ctx: CanvasRenderingContext2D
    ): void {
        if (this.diffMap?.addedKeys.has(elem.guid)) {
            elem.shade(this.renderer, ctx, this.renderer.getCssProperty(
                '--color-diff-added'
            ), 1);
        } else if (this.diffMap?.removedKeys.has(elem.guid)) {
            elem.shade(this.renderer, ctx, this.renderer.getCssProperty(
                '--color-diff-removed'
            ), 1);
        } else if (this.diffMap?.changedKeys.has(elem.guid)) {
            elem.shade(this.renderer, ctx, this.renderer.getCssProperty(
                '--color-diff-changed'
            ), 1);
        }
    }

    protected shadeBlock(
        block: ControlFlowBlock, ctx: CanvasRenderingContext2D, ..._args: any[]
    ): void {
        this.shadeElem(block, ctx);
    }

    protected shadeNode(
        node: SDFGNode, ctx: CanvasRenderingContext2D, ..._args: any[]
    ): void {
        this.shadeElem(node, ctx);
    }

    protected shadeEdge(
        edge: Edge, ctx: CanvasRenderingContext2D, ..._args: any[]
    ): void {
        this.shadeElem(edge, ctx);
    }

    public draw(): void {
        this.shadeSDFG();
    }

}
