// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

import { OverlayManager, SymbolResolver } from '../overlay_manager';
import { SDFGRenderer } from '../renderer/renderer';
import { SDFGElement } from '../renderer/renderer_elements';
import { Point2D } from '../index';

declare const vscode: any;

export class GenericSdfgOverlay {

    protected symbol_resolver: SymbolResolver;
    protected vscode: any;
    protected badness_scale_center: number;
    protected badness_hist_buckets: number[];
    protected overlay_manager: OverlayManager;

    public constructor(
        protected renderer: SDFGRenderer
    ) {
        this.overlay_manager = renderer.get_overlay_manager();
        this.symbol_resolver = this.overlay_manager.get_symbol_resolver();
        this.vscode = typeof vscode !== 'undefined' && vscode;
        this.badness_scale_center = 5;
        this.badness_hist_buckets = [];
    }

    public draw(): void {
        return;
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

    public refresh(): void {
        return;
    }

    // TODO(later): Refactor 'badness' to 'severity'. Everywhere.
    public get_badness_value(val: number): number {
        let badness = 0;

        switch (this.overlay_manager.get_badness_scale_method()) {
            case 'hist':
                {
                    // TODO(later): Allow the user to select a number of bins.
                    const idx = this.badness_hist_buckets.indexOf(val);
                    if (idx < 0)
                        badness = 0;
                    else
                        badness = idx / (this.badness_hist_buckets.length - 1);
                }
                break;
            case 'mean':
            case 'median':
            default:
                badness = (1 / (this.badness_scale_center * 2)) * val;
                break;
        }

        if (badness < 0)
            badness = 0;
        if (badness > 1)
            badness = 1;

        return badness;
    }

}
