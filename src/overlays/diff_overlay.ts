// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import type {
    SDFGRenderer,
} from '../renderer/sdfg/sdfg_renderer';
import type {
    SDFGNode,
    SDFGElement,
    Edge,
    ControlFlowBlock,
} from '../renderer/sdfg/sdfg_elements';
import type { DiffMap } from '../sdfg_diff_viewer';
import { OverlayType } from '../types';
import { GenericSdfgOverlay } from './common/generic_sdfg_overlay';
import { SDFVSettings } from '../utils/sdfv_settings';

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

    public shadeElem(elem: SDFGElement): void {
        if (this.diffMap?.addedKeys.has(elem.guid))
            elem.shade(SDFVSettings.get<string>('diffAddedColor'), 0.5);
        else if (this.diffMap?.removedKeys.has(elem.guid))
            elem.shade(SDFVSettings.get<string>('diffRemovedColor'), 0.5);
        else if (this.diffMap?.changedKeys.has(elem.guid))
            elem.shade(SDFVSettings.get<string>('diffChangedColor'), 0.5);
    }

    protected shadeBlock(
        block: ControlFlowBlock, ..._args: any[]
    ): void {
        this.shadeElem(block);
    }

    protected shadeNode(
        node: SDFGNode, ..._args: any[]
    ): void {
        this.shadeElem(node);
    }

    protected shadeEdge(
        edge: Edge, ..._args: any[]
    ): void {
        this.shadeElem(edge);
    }

    public draw(): void {
        this.shadeSDFG();
    }

}
