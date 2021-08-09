// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

import { OverlayManager, SymbolResolver } from "../overlay_manager";
import { SDFGRenderer } from "../renderer/renderer";
import { SDFGElement } from "../renderer/renderer_elements";

declare const vscode: any;

export class GenericSdfgOverlay {

    protected symbol_resolver: SymbolResolver;
    protected vscode: any;
    protected badness_scale_center: number;

    public constructor(
        protected overlay_manager: OverlayManager,
        protected renderer: SDFGRenderer
    ) {
        this.symbol_resolver = this.overlay_manager.symbol_resolver;
        this.vscode = typeof vscode !== 'undefined' && vscode;
        this.badness_scale_center = 5;
    }

    public draw(): void {
        return;
    }

    public on_mouse_event(
        type: string,
        ev: MouseEvent,
        mousepos: any,
        elements: SDFGElement[],
        foreground_elem: SDFGElement | undefined,
        ends_drag: boolean
    ): boolean {
        return false;
    }

    public refresh(): void {
        return;
    }

}
