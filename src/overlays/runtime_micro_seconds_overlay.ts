// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import { getGraphElementUUID } from '../index';
import { SDFGRenderer } from '../renderer/renderer';
import {
    ControlFlowBlock,
    SDFGElement,
    SDFGNode,
} from '../renderer/renderer_elements';
import { getTempColorHslString } from '../utils/utils';
import {
    GenericSdfgOverlay,
    OverlayType,
    RuntimeReportOverlay,
} from './generic_sdfg_overlay';


export class RuntimeMicroSecondsOverlay extends RuntimeReportOverlay {

    public static readonly type: OverlayType = OverlayType.NODE;
    public readonly olClass: typeof GenericSdfgOverlay =
        RuntimeMicroSecondsOverlay;

    protected criterium: string = 'mean';
    private runtime_map: { [uuids: string]: any } = {};

    public constructor(renderer: SDFGRenderer) {
        super(renderer);
        this.heatmap_scale_center = 0;
    }

    public refresh(): void {
        this.heatmap_scale_center = 5;
        this.heatmap_hist_buckets = [];

        const micros_values = [];

        for (const key of Object.keys(this.runtime_map)) {
            // Make sure the overall SDFG's runtime isn't included in this.
            if (key !== '0/-1/-1/-1')
                micros_values.push(this.runtime_map[key][this.criterium]);
        }

        this.update_heatmap_scale(micros_values);

        if (micros_values.length === 0)
            micros_values.push(0);

        this.renderer.draw_async();
    }

    public pretty_print_micros(micros: number): string {
        let unit = 'µs';
        let value = micros;
        if (micros > 1000) {
            unit = 'ms';
            const millis = micros / 1000;
            value = millis;
            if (millis > 1000) {
                unit = 's';
                const seconds = millis / 1000;
                value = seconds;
            }
        }

        value = Math.round((value + Number.EPSILON) * 100) / 100;
        return value.toString() + ' ' + unit;
    }

    private shadeElem(elem: SDFGElement, ctx: CanvasRenderingContext2D): void {
        const rt_summary = this.runtime_map[getGraphElementUUID(elem)];

        if (rt_summary === undefined)
            return;

        const mousepos = this.renderer.get_mousepos();
        if (mousepos && elem.intersect(mousepos.x, mousepos.y)) {
            // Show the measured runtime.
            if (rt_summary['min'] === rt_summary['max']) {
                this.renderer.set_tooltip(() => {
                    const tt_cont = this.renderer.get_tooltip_container();
                    if (tt_cont) {
                        tt_cont.innerText = this.pretty_print_micros(
                            rt_summary['min']
                        );
                    }
                });
            } else {
                this.renderer.set_tooltip(() => {
                    const tt_cont = this.renderer.get_tooltip_container();
                    if (tt_cont) {
                        tt_cont.innerText = (
                            'Min: ' +
                            this.pretty_print_micros(rt_summary['min']) +
                            '\nMax: ' +
                            this.pretty_print_micros(rt_summary['max']) +
                            '\nMean: ' +
                            this.pretty_print_micros(rt_summary['mean']) +
                            '\nMedian: ' +
                            this.pretty_print_micros(rt_summary['med']) +
                            '\nCount: ' +
                            rt_summary['count']
                        );
                    }
                });
            }
        }

        // Calculate the severity color.
        const micros = rt_summary[this.criterium];
        const color = getTempColorHslString(this.getSeverityValue(micros));

        elem.shade(this.renderer, ctx, color);
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

    public draw(): void {
        this.shadeSDFG();
    }

    public set_runtime_map(runtime_map: { [uuids: string]: any }): void {
        this.runtime_map = runtime_map;
    }

    public clearRuntimeData(): void {
        this.set_runtime_map({});
        this.refresh();
    }

}
