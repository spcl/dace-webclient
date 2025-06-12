// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import type { SDFGRenderer } from '../renderer/sdfg/sdfg_renderer';
import {
    ControlFlowBlock,
    SDFGElement,
    SDFGNode,
} from '../renderer/sdfg/sdfg_elements';
import { getTempColorHslString } from '../utils/utils';
import { getGraphElementUUID } from '../utils/sdfg/sdfg_utils';
import {
    GenericSdfgOverlay,
    RuntimeReportOverlay,
} from './common/generic_sdfg_overlay';
import { OverlayType } from '../types';


type RuntimeSummaryT = Record<string, number>;

export class RuntimeMicroSecondsOverlay extends RuntimeReportOverlay {

    public static readonly type: OverlayType = OverlayType.NODE;
    public readonly olClass: typeof GenericSdfgOverlay =
        RuntimeMicroSecondsOverlay;

    protected _criterium: string = 'mean';
    private runtimeMap: Record<string, RuntimeSummaryT | undefined> = {};

    public constructor(renderer: SDFGRenderer) {
        super(renderer);
        this.heatmapScaleCenter = 0;
    }

    public refresh(): void {
        this.heatmapScaleCenter = 5;
        this.heatmapHistBuckets = [];

        const microsValues: number[] = [];

        for (const key of Object.keys(this.runtimeMap)) {
            // Make sure the overall SDFG's runtime isn't included in this.
            if (key !== '0/-1/-1/-1' && this.runtimeMap[key] !== undefined)
                microsValues.push(this.runtimeMap[key][this.criterium]);
        }

        this.updateHeatmapScale(microsValues);

        if (microsValues.length === 0)
            microsValues.push(0);

        this.renderer.drawAsync();
    }

    public prettyPrintMicroSections(micros: number): string {
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
        const runtimeSummary = this.runtimeMap[getGraphElementUUID(elem)];
        if (runtimeSummary === undefined)
            return;

        const mousepos = this.renderer.getMousePos();
        if (mousepos && elem.intersect(mousepos.x, mousepos.y)) {
            // Show the measured runtime.
            if (runtimeSummary.min === runtimeSummary.max) {
                this.renderer.showTooltip(
                    mousepos.x, mousepos.y,
                    this.prettyPrintMicroSections(runtimeSummary.min)
                );
            } else {
                const tooltipText = (
                    'Min: ' +
                    this.prettyPrintMicroSections(runtimeSummary.min) +
                    '\nMax: ' +
                    this.prettyPrintMicroSections(runtimeSummary.max) +
                    '\nMean: ' +
                    this.prettyPrintMicroSections(runtimeSummary.mean) +
                    '\nMedian: ' +
                    this.prettyPrintMicroSections(runtimeSummary.med) +
                    '\nCount: ' +
                    runtimeSummary.count.toString()
                );
                this.renderer.showTooltip(mousepos.x, mousepos.y, tooltipText);
            }
        }

        // Calculate the severity color.
        const micros = runtimeSummary[this.criterium];
        const color = getTempColorHslString(this.getSeverityValue(micros));

        elem.shade(this.renderer, ctx, color);
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

    public draw(): void {
        this.shadeSDFG();
    }

    public setRuntimeMap(runtimeMap: Record<string, any>): void {
        this.runtimeMap = runtimeMap;
    }

    public clearRuntimeData(): void {
        this.setRuntimeMap({});
        this.refresh();
    }

}
