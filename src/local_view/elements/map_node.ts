// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import { Polygon, Rectangle } from '@pixi/math';
import $ from 'jquery';
import { evaluate as mathEvaluate } from 'mathjs';
import { Text } from 'pixi.js';
import { SDFGRenderer } from '../../renderer/renderer';
import { AccessStack } from '../../utils/collections';
import { showErrorModal } from '../../utils/utils';
import { Graph } from '../graph/graph';
import { Button } from '../gui/button';
import { Slider } from '../gui/slider';
import { LViewGraphParseError } from '../lview_parser';
import { LViewRenderer } from '../lview_renderer';
import { AccessMap, ConcreteDataAccess, DataContainer } from './data_container';
import { DEFAULT_LINE_STYLE, DEFAULT_TEXT_STYLE } from './element';
import { MemoryNode } from './memory_node';
import { Node } from './node';

type Range = {
    itvar: string,
    start: number | string,
    end: number | string,
    step: number | string,
    freeSymbol?: string,
    freeSymbolDefault?: number,
};

export class MapNode extends Node {

    private readonly labels: Text[] = [];
    private readonly sliders: Map<string, Slider> = new Map();
    private readonly freeSymbolSliders: Map<string, [Range, Slider]> =
        new Map();
    public readonly playButton: Button;
    public readonly resetButton: Button;
    public readonly pauseButton: Button;
    public showingAccessPatternControls: boolean = false;
    private labelWidth: number;
    private accessPattern: [
        Map<string, number>, AccessMap<(number | undefined)[]>,
        ConcreteDataAccess[]
    ][];
    private playbackTicker: number = 0;
    private playbackInterval: number | null = null;
    private playbackPlaying: boolean = false;

    private extScope: Map<string, number> = new Map();

    private headerHeight: number = 80;
    private nestingPadding: number = 30;
    private buttonPadding: number = 10;
    private buttonInternalPadding: number = 5;
    private buttonSize: number = 30;

    constructor(
        id: string,
        parentGraph: Graph,
        private ranges: Range[],
        public readonly innerGraph: Graph,
        private readonly overrideWidth?: number,
        private readonly overrideHeight?: number,
        renderer?: LViewRenderer
    ) {
        super(parentGraph, id, renderer);

        try {
            this.nestingPadding = parseInt(
                SDFGRenderer.getCssProperty('--local-view-map-nesting-padding')
            );
            this.headerHeight = parseInt(
                SDFGRenderer.getCssProperty('--local-view-map-header-height')
            );
            this.buttonPadding = parseInt(
                SDFGRenderer.getCssProperty('--local-view-map-button-padding')
            );
            this.buttonInternalPadding = parseInt(
                SDFGRenderer.getCssProperty(
                    '--local-view-map-button-internal-padding'
                )
            );
            this.buttonSize = parseInt(
                SDFGRenderer.getCssProperty('--local-view-map-button-size')
            );
        } catch (_ignored) {
            // Ignored.
        }

        if (this.overrideWidth !== undefined)
            this._width = this.overrideWidth;
        else
            this._width = this.innerGraph.width + (2 * this.nestingPadding);

        if (this.overrideHeight !== undefined) {
            this._height = this.overrideHeight;
        } else {
            this._height = this.innerGraph.height + this.headerHeight +
                (2 * this.nestingPadding);
        }

        // Construct the labels and sliders for each dimension.
        let maxLabelWidth = 0;
        for (let i = 0; i < this.ranges.length; i++) {
            const range = this.ranges[i];
            const labelText =
                range.itvar + '=' + range.start + ':' + range.end +
                (+range.step > 1 ? (':' + range.step) : '');
            const label = new Text(labelText, DEFAULT_TEXT_STYLE);
            label.renderable = false;
            maxLabelWidth = Math.max(maxLabelWidth, label.width + 60);
            label.anchor.set(0.5),
            this.labels.push(label);
        }

        if (this.overrideWidth !== undefined) {
            this.labelWidth = this._width / this.ranges.length;
        } else {
            // If no explicit width was provided, set the map to be wide enough
            // to accomodate the largest label.
            this.labelWidth = Math.max(
                maxLabelWidth,
                this._width / this.ranges.length
            );

            this._width = (this.labelWidth * this.ranges.length);
        }

        for (let i = 0; i < this.ranges.length; i++) {
            const range = this.ranges[i];
            const label = this.labels[i];
            label.position.set(
                (i * this.labelWidth) + (this.labelWidth / 2),
                this.headerHeight / 4
            );
            this.addChild(label);

            let start;
            let end;
            let step;
            if (range.freeSymbol) {
                const scope: Map<string, number> = new Map();
                const symbolDefault = range.freeSymbolDefault !== undefined ?
                    range.freeSymbolDefault : 0;
                scope.set(range.freeSymbol, symbolDefault);

                start = typeof(range.start) === 'string' ?
                    mathEvaluate(range.start, scope) : range.start;
                end = typeof(range.end) === 'string' ?
                    mathEvaluate(range.end, scope) : range.end;
                step = typeof(range.step) === 'string' ?
                    mathEvaluate(range.step, scope) : range.step;
            } else {
                start = typeof(range.start) === 'string' ? 0 : range.start;
                end = typeof(range.end) === 'string' ? 0 : range.end;
                step = typeof(range.step) === 'string' ? 1 : range.step;
            }

            const slider = new Slider(start, end, step, this.labelWidth);
            slider.position.set(
                i * this.labelWidth, this.headerHeight / 2
            );
            this.addChild(slider);
            this.sliders.set(range.itvar, slider);
            if (range.freeSymbol)
                this.freeSymbolSliders.set(range.freeSymbol, [range, slider]);
            slider.onValueChanged(() => {
                this.onSlidersUpdated();
            });
        }

        const buttonRadius = this.buttonSize / 4;
        const playPolygon = new Polygon([
            this.buttonSize / 4,
            this.buttonSize / 4,
            3 * this.buttonSize / 4,
            this.buttonSize / 2,
            this.buttonSize / 4,
            3 * this.buttonSize / 4,
        ]);
        this.playButton = new Button(
            () => {
                this.playbackStart();
            }, playPolygon, this.buttonSize, this.buttonSize,
            buttonRadius
        );
        this.playButton.position.set(
            this.buttonPadding, this.headerHeight + this.buttonPadding
        );
        this.addChild(this.playButton);

        const pRectPaddingRatio = 1.5;
        const pRectHeight = this.buttonSize - 2 * this.buttonInternalPadding;
        const pRectWidth = (
            this.buttonSize - (
                this.buttonInternalPadding * pRectPaddingRatio * 2
            )
        ) / 3;
        const pauseRects = [
            new Rectangle(
                this.buttonInternalPadding * pRectPaddingRatio,
                this.buttonInternalPadding,
                pRectWidth,
                pRectHeight
            ),
            new Rectangle(
                this.buttonSize - (
                    this.buttonInternalPadding * pRectPaddingRatio + pRectWidth
                ),
                this.buttonInternalPadding,
                pRectWidth,
                pRectHeight
            ),
        ];
        this.pauseButton = new Button(
            () => {
                this.playbackPause();
            }, pauseRects, this.buttonSize, this.buttonSize, buttonRadius
        );
        this.pauseButton.disable();
        this.pauseButton.position.set(
            (2 * this.buttonPadding) + this.buttonSize,
            this.headerHeight + this.buttonPadding
        );
        this.addChild(this.pauseButton);

        this.resetButton = new Button(
            () => {
                this.playbackReset();
            }, 'reset', undefined, this.buttonSize, buttonRadius,
            this.buttonSize - this.buttonInternalPadding * 2
        );
        this.resetButton.disable();
        this.resetButton.position.set(
            (3 * this.buttonPadding) + (2 * this.buttonSize),
            this.headerHeight + this.buttonPadding
        );
        this.addChild(this.resetButton);

        this.innerGraph.position.set(
            (this._width / 2) - (this.innerGraph.width / 2),
            this.headerHeight + this.nestingPadding
        );
        this.addChild(this.innerGraph);

        this.draw();

        // Calculate the access pattern on this map's touched memory.
        const scope = new Map<string, number>();
        this.accessPattern = [];
        this.recursiveSimulate(scope, this.ranges, this.accessPattern);

        this.calculateStackDistances();
    }

    public recalculateSize(): void {
        if (this.overrideWidth !== undefined) {
            this._width = this.overrideWidth;
        } else {
            this._width = Math.max(
                this.labelWidth * this.ranges.length,
                this.innerGraph.width + 2 * this.nestingPadding
            );
        }

        if (this.overrideHeight !== undefined) {
            this._height = this.overrideHeight;
        } else {
            this._height = this.innerGraph.height + this.headerHeight +
                2 * this.nestingPadding;
        }

        this.labelWidth = this._width / this.ranges.length;
        for (let i = 0; i < this.labels.length; i++) {
            const range = this.ranges[i];
            const label = this.labels[i];
            label.position.set(
                (i * this.labelWidth) + (this.labelWidth / 2),
                this.headerHeight / 4
            );
            const slider = this.sliders.get(range.itvar);
            slider?.position.set(
                i * this.labelWidth, this.headerHeight / 2
            );
            slider?.updateSliderWidth(this.labelWidth);
        }

        this.innerGraph.position.set(
            (this._width / 2) - (this.innerGraph.width / 2),
            this.headerHeight + this.nestingPadding
        );
    }

    private onSlidersUpdated(): void {
        const scope = new Map<string, number>([...this.extScope.entries()]);

        for (let i = 0; i < this.ranges.length; i++) {
            const range = this.ranges[i];
            const slider = this.sliders.get(range.itvar);

            if (slider)
                scope.set(range.itvar, slider.value);
        }

        const updateParameters = true;
        const accessMapRet = this.innerGraph.getAccessesFor(
            scope, updateParameters
        );

        this.clearAccessMarkings();
        this.showAccesses(accessMapRet[0]);
    }

    private recursiveSimulate(
        scope: Map<string, number>, nRanges: Range[],
        accesses: [
            Map<string, number>, AccessMap<(number | undefined)[]>,
            ConcreteDataAccess[]
        ][]
    ): void {
        const nRange = nRanges[0];
        const newNRanges = nRanges.slice(1);

        // TODO: Obtain from parent scope when symbolic, or attempt to.
        if (typeof(nRange.start) === 'string' ||
            typeof(nRange.end) === 'string' ||
            typeof(nRange.step) === 'string')
            return;

        if (nRange.step === 0) {
            throw new LViewGraphParseError(
                'This graph cannot be simulated due to a map step of 0'
            );
        }
        const cond = nRange.step > 0 ?
            (i: number) => i <= +nRange.end : (i: number) => i >= +nRange.end;
        for (let i = nRange.start; cond(i); i += nRange.step) {
            if (newNRanges.length > 0) {
                this.recursiveSimulate(
                    new Map([...scope.entries(), [nRange.itvar, i]]),
                    newNRanges,
                    accesses
                );
            } else {
                const completeScope = new Map(
                    [...scope.entries(), [nRange.itvar, i]]
                );
                const [map, orderedAccesses] =
                    this.innerGraph.getAccessesFor(completeScope);
                accesses.push([completeScope, map, orderedAccesses]);
            }
        }
    }

    public calculateStackDistances(): void {
        let distThreshold = -1;
        const thresholdRaw = $('#reuse-distance-threshold-input').val();
        if (thresholdRaw !== undefined && typeof(thresholdRaw) === 'string')
            distThreshold = parseInt(thresholdRaw);

        const lineStack = new AccessStack();
        this.accessPattern.forEach(step => {
            const accesses = step[2];
            accesses.forEach(access => {
                const nodes = this.parentGraph.memoryNodesMap.get(
                    access.dataContainer
                );
                const nxt = nodes?.values().next().value;
                if (nxt) {
                    const node = nxt[1];

                    if (node && !access.index.includes(undefined)) {
                        const cl = node.getCacheLine(access.index as number[]);

                        if (cl && cl.length > 0) {
                            const start = cl[0];
                            const distance = lineStack.touch(start);

                            const tile =
                                node.getTileAt(access.index as number[]);
                            const prev = tile?.stackDistances.get(distance);
                            if (prev !== undefined)
                                tile?.stackDistances.set(distance, prev + 1);
                            else
                                tile?.stackDistances.set(distance, 1);

                            if (distance >= 0)
                                tile?.stackDistancesFlattened.push(distance);
                            else if (tile)
                                tile.coldMisses++;

                            const mnPrev =
                                MemoryNode.reuseDistanceHistogram.get(distance);
                            if (mnPrev !== undefined) {
                                MemoryNode.reuseDistanceHistogram.set(
                                    distance, mnPrev + 1
                                );
                            } else {
                                MemoryNode.reuseDistanceHistogram.set(
                                    distance, 1
                                );
                            }

                            if (distance < 0 || distance >= distThreshold) {
                                if (tile) {
                                    const missPrev =
                                        MemoryNode.missesHistogram.get(
                                            tile.totalMisses
                                        );
                                    if (missPrev !== undefined &&
                                        missPrev >= 0) {
                                        if (missPrev > 1) {
                                            MemoryNode.missesHistogram.set(
                                                tile.totalMisses, missPrev - 1
                                            );
                                        } else {
                                            MemoryNode.missesHistogram.delete(
                                                tile.totalMisses
                                            );
                                        }
                                    }
                                    tile.totalMisses++;

                                    const nMissPrev =
                                        MemoryNode.missesHistogram.get(
                                            tile.totalMisses
                                        );
                                    if (nMissPrev !== undefined) {
                                        MemoryNode.missesHistogram.set(
                                            tile.totalMisses, nMissPrev + 1
                                        );
                                    } else {
                                        MemoryNode.missesHistogram.set(
                                            tile.totalMisses, 1
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            });
        });
    }

    public playbackReset(): void {
        MemoryNode.MAX_ACCESSES = 1;
        this.playbackPlaying = false;
        this.playbackTicker = 0;

        this.sliders.forEach(slider => {
            slider.value = slider.getSliderBounds().min;
        });

        this.clearAccessMarkings();

        this.playButton.enable();
        this.pauseButton.disable();
        this.resetButton.disable();
    }

    private clearAccessMarkings(): void {
        // Clear all acces markings on all related memory nodes.
        this.parentGraph.memoryNodesMap.forEach(val => {
            val.forEach(v => {
                v[1].clearAllAccesses();
            });
        });
    }

    public playbackPause(): void {
        this.playbackPlaying = false;

        this.playButton.enable();
        this.pauseButton.disable();
        this.resetButton.enable();
    }

    private playbackStart(): void {
        this.playButton.disable();
        this.pauseButton.enable();
        this.resetButton.disable();

        const playbackSpeedInputVal = (
            <HTMLInputElement> document.getElementById(
                'map-playback-speed-input'
            )
        )?.value;
        const playbackSpeed = parseInt(playbackSpeedInputVal);

        this.playbackPlaying = true;
        this.playbackInterval = window.setInterval(() => {
            if (this.playbackPlaying) {
                this.playbackTickFunction();
            } else {
                if (this.playbackInterval)
                    window.clearInterval(this.playbackInterval);
                this.playbackInterval = null;
            }
        }, 1000 / playbackSpeed);
    }

    public showAccesses(
        map: AccessMap<(number | undefined)[]>, redraw: boolean = true
    ): void {
        map.forEach((accessList, container) => {
            const nodes =
                this.parentGraph.memoryNodesMap.get(container);
            if (nodes) {
                accessList.forEach((access) => {
                    nodes.forEach(node => {
                        node[1].applyToIdx(access[1], (t) => {
                            t.onMarkAccess(redraw);
                        });
                        if (redraw)
                            node[1].draw();
                    });
                });
            }
        });
    }

    private playbackTickFunction() {
        if (this.playbackTicker < this.accessPattern.length) {
            const map = this.accessPattern[this.playbackTicker][1];
            const scope = this.accessPattern[this.playbackTicker][0];

            for (const val of scope) {
                const itvar = val[0];
                const value = val[1];
                const slider = this.sliders.get(itvar);
                if (slider && Number.isInteger(value))
                    slider.value = value;
            }

            this.showAccesses(map);

            this.playbackTicker++;
        } else {
            this.playbackTicker = 0;
            if (this.playbackInterval) {
                window.clearInterval(this.playbackInterval);
                this.playbackInterval = null;
            }

            this.playButton.disable();
            this.pauseButton.disable();
            this.resetButton.enable();
        }
    }

    public draw(): void {
        super.draw();

        // Draw the contents of the map.
        this.innerGraph.draw();
        this.recalculateSize();

        this.labels.forEach((label) => {
            label.renderable = true;
        });

        // Draw the border.
        this.lineStyle(DEFAULT_LINE_STYLE);
        this.beginFill(0xffffff, 0.95);
        this.drawPolygon([
            0,
            this.headerHeight,
            0,
            this.headerHeight / 2,
            this.headerHeight / 2,
            0,
            this._width - (this.headerHeight / 2),
            0,
            this._width,
            this.headerHeight / 2,
            this._width,
            this.headerHeight,
            this._width,
            this._height,
            0,
            this._height,
            0,
            this.headerHeight,
            this._width,
            this.headerHeight,
        ]);
        this.endFill();

        // Draw the sliders.
        this.sliders.forEach((slider) => {
            slider.draw();
        });

        // Draw separating lines between labels.
        for (let i = 0; i < this.labels.length - 1; i++) {
            const lineX = (i + 1) * this.labelWidth;
            this.moveTo(lineX, 0);
            this.lineTo(lineX, this.headerHeight);
        }

        // Draw the buttons if we're in access pattern viewmode.
        if (this.showingAccessPatternControls) {
            this.playButton.renderable = true;
            this.pauseButton.renderable = true;
            this.resetButton.renderable = true;
            this.playButton.enable();
            this.playButton.draw();
            this.pauseButton.draw();
            this.resetButton.draw();
        } else {
            this.playButton.disable();
            this.playButton.renderable = false;
            this.pauseButton.renderable = false;
            this.resetButton.renderable = false;
        }
    }

    private buildScopes(
        scope: Map<string, number>, remaining: [string, number[]][],
        scopes: Map<string, number>[]
    ): void {
        const next = remaining[0];
        next[1].forEach(val => {
            const nScope: { [key: string]: number } = {};
            nScope[next[0]] = val;
            const mergedScope = new Map([...scope.entries(), [next[0], val]]);
            if (remaining.length > 1)
                this.buildScopes(mergedScope, remaining.slice(1), scopes);
            else
                scopes.push(mergedScope);
        });
    }

    public getAccessesFor(
        scope: Map<string, number>, updateParameters: boolean = false
    ): [AccessMap<(number | undefined)[]>, ConcreteDataAccess[]] {
        const idxMap = new AccessMap<(number | undefined)[]>();

        if (updateParameters) {
            this.extScope.clear();

            for (const scopeVal of scope) {
                this.extScope.set(scopeVal[0], scopeVal[1]);

                const itvar = scopeVal[0];
                if (this.freeSymbolSliders.has(itvar)) {
                    const val = this.freeSymbolSliders.get(itvar);

                    if (val === undefined)
                        continue;

                    const slider = val[1];
                    const range = val[0];

                    const start = typeof(range.start) === 'string' ?
                        mathEvaluate(range.start, scope) : range.start;
                    const end = typeof(range.end) === 'string' ?
                        mathEvaluate(range.end, scope) : range.end;
                    const step = typeof(range.step) === 'string' ?
                        mathEvaluate(range.step, scope) : range.step;
                    slider?.updateBounds(
                        start, end, step
                    );
                }
            }
        }

        const rangeValuesMap: [string, number[]][] = [];
        for (const range of this.ranges) {
            let start = undefined;
            if (typeof(range.start) === 'number') {
                start = range.start;
            } else {
                try {
                    start = mathEvaluate(range.start, scope);
                } catch {
                    start = undefined;
                }
            }

            let end = undefined;
            if (typeof(range.end) === 'number') {
                end = range.end;
            } else {
                try {
                    end = mathEvaluate(range.end, scope);
                } catch {
                    end = undefined;
                }
            }

            let step = undefined;
            if (typeof(range.step) === 'number') {
                step = range.step;
            } else {
                try {
                    step = mathEvaluate(range.step, scope);
                } catch {
                    step = undefined;
                }
            }

            if (start !== undefined && end !== undefined &&
                step !== undefined) {
                const vals = [];
                for (let i = start; i < end; i += step)
                    vals.push(i);
                rangeValuesMap.push([range.itvar, vals]);
            } else {
                let errMsg = 'Failed to get accesses for the scope: {';
                let sep = '';
                for (const [k, v] of scope) {
                    errMsg += sep + k + ': ' + v.toString();
                    sep = ', ';
                }
                errMsg + '}. The access range [' +
                    range.start.toString() + ':' +
                    range.end.toString() + ':' +
                    range.step.toString() + '] cannot be evaluated under ' +
                    'the given scope.';
                showErrorModal(errMsg);
            }
        }

        const scopes: Map<string, number>[] = [];
        this.buildScopes(new Map(), rangeValuesMap, scopes);

        const accessOrder: ConcreteDataAccess[] = [];

        for (const s of scopes) {
            const [subIdxMap, subAccessOrder] = this.innerGraph.getAccessesFor(
                new Map([...scope.entries(), ...s.entries()])
            );
            subIdxMap.forEach(
                (val, key) => {
                    const prev = idxMap.get(key);
                    if (prev !== undefined)
                        idxMap.set(key, prev.concat(val));
                    else
                        idxMap.set(key, val);
                }
            );

            accessOrder.push(...subAccessOrder);
        }

        return [idxMap, accessOrder];
    }

    public getRelatedAccesses(
        source: DataContainer, index: number[], _origin?: Node
    ): AccessMap<(number | undefined)[]> {
        return this.innerGraph.getRelatedAccesses(source, index);
    }

    public getAccessPattern(): [
        Map<string, number>, AccessMap<(number | undefined)[]>,
        ConcreteDataAccess[]
    ][] {
        return this.accessPattern;
    }

    public get unscaledWidth(): number {
        if (this.overrideWidth) {
            return this.overrideWidth;
        } else {
            return Math.max(
                this.labelWidth * this.ranges.length,
                this.innerGraph.width + 2 * this.nestingPadding
            );
        }
    }

    public get unscaledHeight(): number {
        if (this.overrideHeight) {
            return this.overrideHeight;
        } else {
            return this.innerGraph.height + this.headerHeight +
                2 * this.nestingPadding;
        }
    }

}
