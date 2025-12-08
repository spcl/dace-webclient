// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import 'bootstrap';

import '../scss/sdfv.scss';

import { EventEmitter } from 'events';
import { mean, median } from 'mathjs';
import type { LViewRenderer } from './local_view/lview_renderer';
import {
    RuntimeMicroSecondsOverlay,
} from './overlays/runtime_micro_seconds_overlay';
import type { SDFGRenderer } from './renderer/sdfg/sdfg_renderer';
import type { ISDFVUserInterface } from './sdfv_ui';
import { doForAllJsonSDFGElements } from './utils/sdfg/traversal';


export interface ISDFV {
    linkedUI: ISDFVUserInterface;

    outline(): void;
}

interface ITraceEvent {
    ph: string;
    args: {
        sdfg_id: string;
        state_id?: string;
        id?: string;
    };
    dur: number;
}

export abstract class SDFV extends EventEmitter implements ISDFV {

    protected _renderer?: SDFGRenderer;
    protected _localViewRenderer?: LViewRenderer;

    public constructor() {
        super();
        return;
    }

    public abstract get linkedUI(): ISDFVUserInterface;

    public onLoadedRuntimeReport(
        report: { traceEvents?: ITraceEvent[] }, renderer?: SDFGRenderer
    ): void {
        const runtimeMap: Record<string, number[] | undefined> = {};
        const summaryMap: Record<string, Record<string, number>> = {};

        renderer = this.renderer;

        if (report.traceEvents && renderer) {
            for (const event of report.traceEvents) {
                if (event.ph === 'X') {
                    let uuid = event.args.sdfg_id + '/';
                    if (event.args.state_id !== undefined) {
                        uuid += event.args.state_id + '/';
                        if (event.args.id !== undefined)
                            uuid += event.args.id + '/-1';
                        else
                            uuid += '-1/-1';
                    } else {
                        uuid += '-1/-1/-1';
                    }

                    if (runtimeMap[uuid] !== undefined)
                        runtimeMap[uuid]!.push(event.dur);
                    else
                        runtimeMap[uuid] = [event.dur];
                }
            }

            for (const key in runtimeMap) {
                const values = runtimeMap[key] ?? [];
                const minmax = getMinMax(values);
                const min = minmax[0];
                const max = minmax[1];
                const rtSummary = {
                    'min': min,
                    'max': max,
                    'mean': mean(values),
                    'med': median(values),
                    'count': values.length,
                };
                summaryMap[key] = rtSummary;
            }

            if (!renderer.overlayManager.isOverlayActive(
                RuntimeMicroSecondsOverlay
            )) {
                renderer.overlayManager.registerOverlay(
                    RuntimeMicroSecondsOverlay
                );
            }
            const ol = renderer.overlayManager.getOverlay(
                RuntimeMicroSecondsOverlay
            );
            if (ol && ol instanceof RuntimeMicroSecondsOverlay) {
                ol.setRuntimeMap(summaryMap);
                ol.refresh();
            }
        }
    }

    public onLoadedMemoryFootprintFile(
        footprintMap: Record<string, number>, renderer?: SDFGRenderer
    ): void {
        renderer = this.renderer;

        if (!renderer?.sdfg)
            return;

        doForAllJsonSDFGElements((_group, _info, elem) => {
            const guid = elem.attributes?.guid as string | undefined;
            if (guid && guid in footprintMap)
                elem.attributes!.maxFootprintBytes = footprintMap[guid];
        }, renderer.sdfg);

        renderer.drawAsync();
    }

    public abstract outline(): void;

    public setRenderer(renderer?: SDFGRenderer): void {
        if (renderer) {
            this._localViewRenderer?.destroy();
            this._localViewRenderer?.resizeObserver.disconnect();
            this._localViewRenderer = undefined;
        }
        this._renderer = renderer;

        this.linkedUI.enableInfoClear();
        this.linkedUI.infoClear();
    }

    public setLocalViewRenderer(localViewRenderer?: LViewRenderer): void {
        if (localViewRenderer) {
            this._renderer?.destroy();
            this._renderer = undefined;
        }
        this._localViewRenderer = localViewRenderer;
    }

    public get renderer(): SDFGRenderer | undefined {
        return this._renderer;
    }

    public get localViewRenderer(): LViewRenderer | undefined {
        return this._localViewRenderer;
    }

}

/**
 * Get the min/max values of an array.
 * This is more stable than Math.min/max for large arrays, since Math.min/max
 * is recursive and causes a too high stack-length with long arrays.
 */
function getMinMax(arr: number[]): [number, number] {
    let max = -Number.MAX_VALUE;
    let min = Number.MAX_VALUE;
    arr.forEach(val => {
        if (val > max)
            max = val;
        if (val < min)
            min = val;
    });
    return [min, max];
}
