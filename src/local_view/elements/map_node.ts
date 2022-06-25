import { Polygon, Rectangle } from '@pixi/math';
import $ from 'jquery';
import { evaluate as mathEvaluate } from 'mathjs';
import { Text } from 'pixi.js';
import { AccessStack } from '../../utils/collections';
import { Graph } from '../graph/graph';
import { Button } from '../gui/button';
import { Slider } from '../gui/slider';
import { AccessMap, ConcreteDataAccess, DataContainer } from './data_container';
import { DEFAULT_LINE_STYLE, DEFAULT_TEXT_STYLE } from './element';
import { MemoryNode } from './memory_node';
import { Node } from './node';

const HEADER_HEIGHT = 80;
const NESTING_PADDING = 7;
const BUTTON_PADDING = 10;

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
    private readonly playButton: Button;
    private readonly resetButton: Button;
    private readonly pauseButton: Button;
    private labelWidth: number;
    private accessPattern: [
        Map<string, number>, AccessMap<(number | undefined)[]>,
        ConcreteDataAccess[]
    ][];
    private playbackTicker: number = 0;
    private playbackInterval: NodeJS.Timeout | null = null;
    private playbackPlaying: boolean = false;

    // TODO: Don't cache this.
    private extScope: Map<string, number> = new Map();

    constructor(
        id: string,
        parentGraph: Graph,
        private ranges: Range[],
        public readonly innerGraph: Graph,
        private readonly overrideWidth?: number,
        private readonly overrideHeight?: number,
        private readonly paddingOverride?: number,
    ) {
        super(parentGraph, id);

        const padding = this.paddingOverride !== undefined ?
            this.paddingOverride : NESTING_PADDING;

        if (this.overrideWidth !== undefined)
            this._width = this.overrideWidth;
        else
            this._width = this.innerGraph.width + (2 * padding);

        if (this.overrideHeight !== undefined)
            this._height = this.overrideHeight;
        else
            this._height =
                this.innerGraph.height + HEADER_HEIGHT + (2 * padding);

        // Construct the labels and sliders for each dimension.
        let maxLabelWidth = 0;
        for (let i = 0; i < this.ranges.length; i++) {
            const range = this.ranges[i];
            const labelText =
                range.itvar + '=' + range.start + ':' + range.end +
                (range.step > 1 ? (':' + range.step) : '');
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
                HEADER_HEIGHT / 4
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
                i * this.labelWidth, HEADER_HEIGHT / 2
            );
            this.addChild(slider);
            this.sliders.set(range.itvar, slider);
            if (range.freeSymbol)
                this.freeSymbolSliders.set(range.freeSymbol, [range, slider]);
            slider.onValueChanged(() => {
                this.onSlidersUpdated();
            });
        }

        const buttonWidth = 30;
        const buttonHeight = buttonWidth;
        const buttonRadius = buttonWidth / 4;
        const playPolygon = new Polygon([
            buttonWidth / 4, buttonHeight / 4,
            3 * buttonWidth / 4, buttonHeight / 2,
            buttonWidth / 4, 3 * buttonHeight / 4,
        ]);
        this.playButton = new Button(
            () => {
                this.playbackStart();
            }, playPolygon, buttonWidth, buttonHeight,
            buttonRadius
        );
        this.playButton.position.set(
            BUTTON_PADDING, HEADER_HEIGHT + BUTTON_PADDING
        );
        this.addChild(this.playButton);

        const pauseRects = [
            new Rectangle(
                buttonWidth / 4, buttonWidth / 4,
                (buttonWidth / 4) - (buttonWidth / 15), buttonWidth / 2
            ),
            new Rectangle(
                (buttonWidth / 2) + (buttonWidth / 15), buttonWidth / 4,
                (buttonWidth / 4) - (buttonWidth / 15),
                buttonWidth / 2
            ),
        ];
        this.pauseButton = new Button(
            () => {
                this.playbackPause();
            }, pauseRects, buttonWidth, buttonWidth, buttonRadius
        );
        this.pauseButton.disable();
        this.pauseButton.position.set(
            (2 * BUTTON_PADDING) + buttonWidth, HEADER_HEIGHT + BUTTON_PADDING
        );
        this.addChild(this.pauseButton);

        this.resetButton = new Button(
            () => {
                this.playbackReset();
            }, 'reset', undefined, buttonWidth, buttonRadius, 20
        );
        this.resetButton.disable();
        this.resetButton.position.set(
            (3 * BUTTON_PADDING) + (2 * buttonWidth),
            HEADER_HEIGHT + BUTTON_PADDING
        );
        this.addChild(this.resetButton);

        this.innerGraph.position.set(
            (this._width / 2) - (this.innerGraph.width / 2),
            HEADER_HEIGHT + (this.paddingOverride !== undefined ?
                this.paddingOverride : NESTING_PADDING)
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
        if (this.overrideWidth !== undefined)
            this._width = this.overrideWidth;
        else
            this._width = Math.max(
                this.labelWidth * this.ranges.length,
                this.innerGraph.width +
                    2 * (this.paddingOverride !== undefined ?
                        this.paddingOverride : NESTING_PADDING)
            );

        if (this.overrideHeight !== undefined)
            this._height = this.overrideHeight;
        else
            this._height = this.innerGraph.height + HEADER_HEIGHT +
                2 * (this.paddingOverride !== undefined ?
                    this.paddingOverride : NESTING_PADDING);

        this.labelWidth = this._width / this.ranges.length;
        for (let i = 0; i < this.labels.length; i++) {
            const range = this.ranges[i];
            const label = this.labels[i];
            label.position.set(
                (i * this.labelWidth) + (this.labelWidth / 2),
                HEADER_HEIGHT / 4
            );
            const slider = this.sliders.get(range.itvar);
            slider?.position.set(
                i * this.labelWidth, HEADER_HEIGHT / 2
            );
            slider?.updateSliderWidth(this.labelWidth);
        }

        this.innerGraph.position.set(
            (this._width / 2) - (this.innerGraph.width / 2),
            HEADER_HEIGHT + (this.paddingOverride !== undefined ?
                this.paddingOverride : NESTING_PADDING)
        );
    }

    private onSlidersUpdated(): void {
        // TODO: We shouldn't save / cache extScope, but get it from the parent
        //  instead to make sure it's up-to-date.
        const scope = new Map<string, number>([...this.extScope.entries()]);

        for (let i = 0; i < this.ranges.length; i++) {
            const range = this.ranges[i];
            const slider = this.sliders.get(range.itvar);

            if (slider)
                scope.set(range.itvar, slider.value);
        }

        const updateParameters = true;
        const [accessMap, orderedAccesses] = this.innerGraph.getAccessesFor(
            scope, updateParameters
        );
        
        this.clearAccessMarkings();
        this.showAccesses(accessMap);
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

        // TODO: Allow inverse traversal (negative step) -> adapt end cond..
        for (let i = nRange.start; i < nRange.end; i += nRange.step) {
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
        const thresholdRaw = $('#reuseDistanceThresholdInput').val();
        if (thresholdRaw !== undefined && typeof(thresholdRaw) === 'string')
            distThreshold = parseInt(thresholdRaw);

        const lineStack = new AccessStack();
        this.accessPattern.forEach(step => {
            const accesses = step[2];
            accesses.forEach(access => {
                const nodes = this.parentGraph.memoryNodesMap.get(
                    access.dataContainer
                );
                if (nodes) {
                    const node = nodes.values().next().value[1];

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
                            if (mnPrev !== undefined)
                                MemoryNode.reuseDistanceHistogram.set(
                                    distance, mnPrev + 1
                                );
                            else
                                MemoryNode.reuseDistanceHistogram.set(
                                    distance, 1
                                );

                            if (distance < 0 || distance >= distThreshold) {
                                if (tile) {
                                    const missPrev =
                                        MemoryNode.missesHistogram.get(
                                            tile.totalMisses
                                        );
                                    if (missPrev !== undefined &&
                                        missPrev >= 0) {
                                        if (missPrev > 1)
                                            MemoryNode.missesHistogram.set(
                                                tile.totalMisses, missPrev - 1
                                            );
                                        else
                                            MemoryNode.missesHistogram.delete(
                                                tile.totalMisses
                                            );
                                    }
                                    tile.totalMisses++;

                                    const nMissPrev =
                                        MemoryNode.missesHistogram.get(
                                            tile.totalMisses
                                        );
                                    if (nMissPrev !== undefined)
                                        MemoryNode.missesHistogram.set(
                                            tile.totalMisses, nMissPrev + 1
                                        );
                                    else
                                        MemoryNode.missesHistogram.set(
                                            tile.totalMisses, 1
                                        );
                                }
                            }
                        }
                    }
                }
            });
        });
    }

    private playbackReset(): void {
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

    private playbackPause(): void {
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
            <HTMLInputElement> document.getElementById('mapPlaybackSpeedInput')
        )?.value;
        const playbackSpeed = parseInt(playbackSpeedInputVal);

        this.playbackPlaying = true;
        this.playbackInterval = setInterval(() => {
            if (this.playbackPlaying) {
                this.playbackTickFunction();
            } else {
                if (this.playbackInterval)
                    clearInterval(this.playbackInterval);
                this.playbackInterval = null;
            }
        }, 1000 / playbackSpeed);
    }

    private showAccesses(map: AccessMap<(number | undefined)[]>): void {
        map.forEach((accessList, container) => {
            const nodes =
                this.parentGraph.memoryNodesMap.get(container);
            if (nodes) {
                accessList.forEach((access) => {
                    nodes.forEach(node => {
                        node[1].applyToIdx(access[1], (t) => t.onMarkAccess());
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
                clearInterval(this.playbackInterval);
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
        this.drawPolygon([
            0, HEADER_HEIGHT,
            0, HEADER_HEIGHT / 2,
            HEADER_HEIGHT / 2, 0,
            this._width - (HEADER_HEIGHT / 2), 0,
            this._width, HEADER_HEIGHT / 2,
            this._width, HEADER_HEIGHT,
            this._width, this._height,
            0, this._height,
            0, HEADER_HEIGHT,
            this._width, HEADER_HEIGHT,
        ]);

        // Draw the sliders.
        this.sliders.forEach((slider) => {
            slider.draw();
        });

        // Draw separating lines between labels.
        for (let i = 0; i < this.labels.length - 1; i++) {
            const lineX = (i + 1) * this.labelWidth;
            this.moveTo(lineX, 0);
            this.lineTo(lineX, HEADER_HEIGHT);
        }

        // Draw the buttons if we're in access pattern viewmode.
        if ($('#input-access-pattern-viewmode').is(':checked')) {
            this.playButton.renderable = true;
            this.pauseButton.renderable = true;
            this.resetButton.renderable = true;
            this.playButton.draw();
            this.pauseButton.draw();
            this.resetButton.draw();
        } else {
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
            // TODO: should we clear here? Maybe other times is better.
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
        this.ranges.forEach(range => {
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
                // TODO: Handle the case where at least one of the ranges canot
                // be evaluated.
            }
        });

        const scopes: Map<string, number>[] = [];
        this.buildScopes(new Map(), rangeValuesMap, scopes);

        const accessOrder: ConcreteDataAccess[] = [];

        scopes.forEach(s => {
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
        });

        return [idxMap, accessOrder];
    }

    public getRelatedAccesses(
        source: DataContainer, index: number[]
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
        if (this.overrideWidth)
            return this.overrideWidth;
        else
            return Math.max(
                this.labelWidth * this.ranges.length,
                this.innerGraph.width +
                    2 * (this.paddingOverride !== undefined ?
                        this.paddingOverride : NESTING_PADDING)
            );
    }

    public get unscaledHeight(): number {
        if (this.overrideHeight)
            return this.overrideHeight;
        else
            return this.innerGraph.height + HEADER_HEIGHT +
                2 * (this.paddingOverride !== undefined ?
                    this.paddingOverride : NESTING_PADDING);
    }

}
