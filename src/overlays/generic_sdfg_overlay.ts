// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import { log, mean, median } from 'mathjs';
import { Point2D } from '../index';
import { OverlayManager, SymbolResolver } from '../overlay_manager';
import {
    GraphElementInfo,
    SDFGElementGroup,
    SDFGRenderer,
} from '../renderer/renderer';
import { SDFGElement } from '../renderer/renderer_elements';

declare const vscode: any;

export enum OverlayType {
    NODE,
    EDGE,
    BOTH,
}

export class GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.BOTH;
    public readonly olClass: typeof GenericSdfgOverlay = GenericSdfgOverlay;

    protected symbolResolver: SymbolResolver;
    protected vscode: any;
    protected heatmap_scale_center: number;
    protected heatmap_hist_buckets: number[];
    protected overlay_manager: OverlayManager;

    public constructor(
        protected renderer: SDFGRenderer
    ) {
        this.overlay_manager = renderer.get_overlay_manager();
        this.symbolResolver = this.overlay_manager.get_symbol_resolver();
        this.vscode = typeof vscode !== 'undefined' && vscode;
        this.heatmap_scale_center = 5;
        this.heatmap_hist_buckets = [];
    }

    public draw(): void {
        return;
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

    public refresh(): void {
        return;
    }

    protected update_heatmap_scale(values: number[]): void {
        if (!values || values.length === 0)
            return;

        switch (this.overlay_manager.get_heatmap_scaling_method()) {
            case 'hist':
                {
                    const n = this.overlay_manager
                        .get_heatmap_scaling_hist_n_buckets();
                    if (n <= 1) {
                        this.heatmap_hist_buckets = [...new Set(values)];
                    } else {
                        this.heatmap_hist_buckets = [];
                        const minval = Math.min(...values);
                        const maxval = Math.max(...values);
                        const step = (maxval - minval) / n;
                        for (let i = 0; i < n; i++)
                            this.heatmap_hist_buckets.push(minval + (i * step));
                    }
                    this.heatmap_hist_buckets.sort((a, b) => {
                        return a - b;
                    });
                }
                break;
            case 'linear_interpolation':
                this.heatmap_scale_center = (
                    Math.min(...values) + Math.max(...values)
                ) / 2;
                break;
            case 'exponential_interpolation':
                this.heatmap_scale_center = log(
                    Math.min(...values) * Math.max(...values),
                    this.overlay_manager.get_heatmap_scaling_exp_base()
                );
                break;
            case 'mean':
                this.heatmap_scale_center = mean(values);
                break;
            case 'median':
            default:
                this.heatmap_scale_center = median(values);
                break;
        }
    }

    public getSeverityValue(val: number): number {
        let severity = 0;

        switch (this.overlay_manager.get_heatmap_scaling_method()) {
            case 'hist':
                {
                    let i;
                    for (i = 0; i < this.heatmap_hist_buckets.length - 1; i++) {
                        if (val <= this.heatmap_hist_buckets[i])
                            break;
                    }
                    severity = i / (this.heatmap_hist_buckets.length - 1);
                }
                break;
            case 'mean':
            case 'median':
            case 'linear_interpolation':
            case 'exponential_interpolation':
            default:
                severity = (1 / (this.heatmap_scale_center * 2)) * val;
                break;
        }

        if (severity < 0)
            severity = 0;
        if (severity > 1)
            severity = 1;

        return severity;
    }

}

export abstract class RuntimeReportOverlay extends GenericSdfgOverlay {

    protected abstract criterium: string;

    public abstract clearRuntimeData(): void;

    public set_criterium(criterium: string): void {
        this.criterium = criterium;
    }

    public get_criterium(): string {
        return this.criterium;
    }

}
