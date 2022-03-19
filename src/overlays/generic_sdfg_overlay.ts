// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

import { OverlayManager, SymbolResolver } from '../overlay_manager';
import { SDFGRenderer } from '../renderer/renderer';
import { SDFGElement } from '../renderer/renderer_elements';
import { Point2D } from '../index';
import { max, mean, median, min, sqrt } from 'mathjs';

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

    protected update_badness_scale(values: number[]): void {
        if (!values || values.length === 0)
            return;

        switch (this.overlay_manager.get_badness_scale_method()) {
            case 'hist':
                this.badness_hist_buckets = [...new Set(values)];
                this.badness_hist_buckets.sort((a, b) => { return a - b; });
                break;
            case 'linear_interpolation':
                this.badness_scale_center = (
                    min(values) + max(values)
                ) / 2;
                break;
            case 'exponential_interpolation':
                // TODO: Allow the use of a factor other than 2.
                this.badness_scale_center = sqrt(
                    min(values) * max(values)
                );
                break;
            case 'mean':
                this.badness_scale_center = mean(values);
                break;
            case 'median':
            default:
                this.badness_scale_center = median(values);
                break;
        }
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
            case 'linear_interpolation':
            case 'exponential_interpolation':
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
