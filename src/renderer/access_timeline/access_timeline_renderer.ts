// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import {
    HTMLCanvasRenderer,
} from 'rendure/src/renderer/core/html_canvas/html_canvas_renderer';
import {
    InputOutputMap,
    MemoryEvent,
    MemoryTimelineScope,
} from '../../access_timeline_view';
import { JsonSDFG, SimpleRect } from '../../types';
import {
    AllocatedContainer,
    ContainerAccess,
    TimelineChart,
    TimelineViewElement,
    TimelineViewElementClasses,
} from './access_timeline_elements';


export class AccessTimelineRenderer extends HTMLCanvasRenderer {

    public sdfg?: JsonSDFG;
    public inputOutputDefinitions?: InputOutputMap;
    public sdfgList = new Map<number, JsonSDFG>();

    private chart?: TimelineChart;

    private hoveredElement?: TimelineViewElement;

    public constructor(
        container: JQuery,
        extMouseHandler: (
            (...args: any[]) => boolean
        ) | null = null,
        initialUserTransform: DOMMatrix | null = null,
        backgroundColor: string | null = null,
        debugDraw = false
    ) {
        super(
            container,
            extMouseHandler,
            initialUserTransform,
            backgroundColor,
            debugDraw
        );

        this.canvas.id = 'timeline-canvas';

        this.onresize();

        /*
        const br = () => this.canvas.getBoundingClientRect();

        const compX = (event: any): number => {
            const left = br().left;
            return this.canvasManager.mapPixelToCoordsX(
                event.clientX - (left ? left : 0)
            );
        };
        const compY = (event: any): number => {
            const top = br().top;
            return this.canvasManager.mapPixelToCoordsY(
                event.clientY - (top ? top : 0)
            );
        };

        // Mouse handler event types
        for (const evtype of [
            'mousedown',
            'mousemove',
            'mouseup',
            'touchstart',
            'touchmove',
            'touchend',
            'wheel',
            'click',
            'dblclick',
            'contextmenu',
        ]) {
            this.canvas.addEventListener(evtype, x => {
                const cancelled = this.onMouseEvent(
                    x, compX, compY, evtype
                );
                if (cancelled)
                    return;
            });
        }
        */
    }

    public setTimeline(
        timeline: MemoryEvent[], scopes: MemoryTimelineScope[]
    ): void {
        this.chart = new TimelineChart(timeline, scopes[0], this);
        this.zoomToFitContents();
        this.drawAsync();
    }

    public internalDraw(dt?: number, ctx?: CanvasRenderingContext2D): void {
        this.chart?.draw(this.mousePos);
    }

    public doForIntersectedElements(
        x: number, y: number, w: number, h: number,
        func: (el: TimelineViewElement, cat: TimelineViewElementClasses) => any
    ): void {
        if (!this.chart?.intersect(x, y, w, h))
            return;

        for (const ax of this.chart.axes) {
            if (ax.intersect(x, y, w, h))
                func(ax, 'axes');
        }

        for (const cont of this.chart.containers) {
            if (cont.intersect(x, y, w, h)) {
                func(cont, 'container');
                for (const access of cont.accesses) {
                    if (access.intersect(x, y, w, h))
                        func(access, 'access');
                }
            }
        }

        for (const scope of this.chart.scopes) {
            if (scope.intersect(x, y, w, h))
                func(scope, 'axes');
        }
    }

    public elementsInRect(
        x: number, y: number, w: number, h: number
    ): Set<TimelineViewElement> {
        const elements = new Set<TimelineViewElement>();
        this.doForIntersectedElements(x, y, w, h, (elem, _cat) => {
            elements.add(elem);
        });
        return elements;
    }

    private findElementsUnderCursor(mouseX: number, mouseY: number): {
        elements: Set<TimelineViewElement>,
        foregroundElement?: TimelineViewElement,
    } {
        // Find all elements under the cursor.
        const elements = this.elementsInRect(mouseX, mouseY, 0, 0);
        let foregroundElement = undefined;
        // The foreground element is always an access, if one exists. If not,
        // it will be an allocation, and if no such item exists, it will be a
        // meta element, such as chart axes.
        for (const elem of elements) {
            if (elem instanceof ContainerAccess)
                foregroundElement = elem;
        }
        if (!foregroundElement) {
            for (const elem of elements) {
                if (elem instanceof AllocatedContainer)
                    foregroundElement = elem;
            }
        }
        foregroundElement ??= elements.values().next().value;

        return { elements, foregroundElement };
    }

    protected _drawMinimapContents(): void {
        return;
    }

    protected registerMouseHandlers(): void {
        return;
    }

    /*
    public onMouseEvent(
        event: any,
        compXFunc: (event: any) => number,
        compYFunc: (event: any) => number,
        evtype: string = 'other'
    ): boolean {
        if (!this.chart)
            return false;

        let dirty = false;
        let elementFocusChanged = false;

        if (evtype === 'mousedown' || evtype === 'touchstart') {
            this.dragStart = event;
        } else if (evtype === 'mouseup') {
            this.dragStart = null;
        } else if (evtype === 'touchend') {
            if (event.touches.length === 0)
                this.dragStart = null;
            else
                this.dragStart = event;
        } else if (evtype === 'mousemove') {
            // Calculate the change in mouse position in canvas coordinates
            this.mousePos = {
                x: compXFunc(event),
                y: compYFunc(event),
            };
            this.realMousePos = { x: event.clientX, y: event.clientY };

            if (this.dragStart && event.buttons & 1) {
                this.dragging = true;

                // Mouse move in panning mode
                this.canvasManager.translate(
                    event.movementX, event.movementY
                );

                // Mark for redraw
                dirty = true;
            } else if (this.dragStart && event.buttons & 4) {
                // Pan the view with the middle mouse button
                this.dragging = true;
                this.canvasManager.translate(
                    event.movementX, event.movementY
                );
                dirty = true;
                elementFocusChanged = true;
            } else {
                this.dragStart = null;
                if (event.buttons & 1 || event.buttons & 4)
                    return true; // Don't stop propagation
            }
        } else if (evtype === 'touchmove') {
            if (this.dragStart.touches.length !== event.touches.length) {
                // Different number of touches, ignore and reset drag_start
                this.dragStart = event;
            } else if (event.touches.length === 1) { // Move/drag
                const movX = (
                    event.touches[0].clientX -
                    this.dragStart.touches[0].clientX
                );
                const movY = (
                    event.touches[0].clientY -
                    this.dragStart.touches[0].clientY
                );

                this.canvasManager.translate(movX, movY);
                this.dragStart = event;

                // Mark for redraw
                dirty = true;
                this.drawAsync();
                return false;
            } else if (event.touches.length === 2) {
                // Find relative distance between two touches before and after.
                // Then, center and zoom to their midpoint.
                const touch1 = this.dragStart.touches[0];
                const touch2 = this.dragStart.touches[1];
                let x1 = touch1.clientX, x2 = touch2.clientX;
                let y1 = touch1.clientY, y2 = touch2.clientY;
                const oldCenter = [(x1 + x2) / 2.0, (y1 + y2) / 2.0];
                const initialDistance = Math.sqrt(
                    (x1 - x2) ** 2 + (y1 - y2) ** 2
                );
                x1 = event.touches[0].clientX; x2 = event.touches[1].clientX;
                y1 = event.touches[0].clientY; y2 = event.touches[1].clientY;
                const currentDistance = Math.sqrt(
                    (x1 - x2) ** 2 + (y1 - y2) ** 2
                );
                const newCenter = [(x1 + x2) / 2.0, (y1 + y2) / 2.0];

                // First, translate according to movement of center point
                const movX = newCenter[0] - oldCenter[0];
                const movY = newCenter[1] - oldCenter[1];

                this.canvasManager.translate(movX, movY);

                // Then scale
                this.canvasManager.scale(
                    currentDistance / initialDistance, newCenter[0],
                    newCenter[1]
                );

                this.dragStart = event;

                // Mark for redraw
                dirty = true;
                this.drawAsync();
                return false;
            }
        } else if (evtype === 'wheel') {
            // Get physical x,y coordinates (rather than canvas coordinates)
            const br = this.canvas.getBoundingClientRect();
            const x = event.clientX - (br ? br.x : 0);
            const y = event.clientY - (br ? br.y : 0);
            this.canvasManager.scale(event.deltaY > 0 ? 0.9 : 1.1, x, y);
            dirty = true;
            elementFocusChanged = true;
        }

        if (!this.mousePos)
            return true;

        const elementsUnderCursor = this.findElementsUnderCursor(
            this.mousePos.x, this.mousePos.y
        );

        if (elementsUnderCursor.foregroundElement) {
            if (elementsUnderCursor.foregroundElement !== this.hoveredElement) {
                if (this.hoveredElement)
                    this.hoveredElement.hovered = false;
                elementFocusChanged = true;
                this.hoveredElement = elementsUnderCursor.foregroundElement;
                this.hoveredElement.hovered = true;
            }
        } else {
            if (this.hoveredElement) {
                this.hoveredElement.hovered = false;
                this.hoveredElement = undefined;
                elementFocusChanged = true;
            }
        }

        if (elementFocusChanged) {
            if (!this.hoveredElement)
                this.hideTooltip();
            dirty = true;
        }

        if (dirty)
            this.drawAsync();

        return false;
    }
    */

    public getContentsBoundingBox(): SimpleRect {
        if (this.chart) {
            return {
                x: this.chart.x,
                y: this.chart.y,
                w: this.chart.width,
                h: this.chart.height,
            };
        } else {
            return {
                x: 0,
                y: 0,
                w: 0,
                h: 0,
            };
        }
    }

    protected initUI(): void {
        return;
    }

}
