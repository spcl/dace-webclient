// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';

import 'bootstrap';

import '../../scss/access_timeline.scss';
import { read_or_decompress } from '../utils/sdfg/json_serializer';
import { CanvasManager } from './canvas_manager';
import { TimelineGraph } from './renderer_elements';
import { Point2D, SimpleRect } from '../types';

interface Subset {
    type: string;
    ranges: {
        start: string;
        end: string;
        step: string;
        tile: string;
    }[];
}

export interface MemoryEvent {
    type: 'DataAccessEvent' | 'AllocationEvent' | 'DeallocationEvent';
}

export interface DataAccessEvent extends MemoryEvent {
    type: 'DataAccessEvent';
    alloc_name: string;
    data: string;
    container_sdfg: number;
    sdfg: number;
    block?: string;
    anode?: string;
    edge?: string;
    subset: Subset;
    mode: 'write' | 'read';
    conditional: boolean;
}

export interface AllocationEvent extends MemoryEvent {
    type: 'AllocationEvent';
    data: [string, number][];
    sdfg: number;
    scope: string;
    conditional: boolean;
}

export interface DeallocationEvent extends MemoryEvent {
    type: 'DeallocationEvent';
    data: string[];
    sdfg: number;
    scope: string;
    conditional: boolean;
}

export class TimelineView {

    private timeline: MemoryEvent[] | null = null;
    private graph?: TimelineGraph;

    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private readonly canvasManager: CanvasManager;
    public readonly backgroundColor: string;
    public readonly debugDraw: boolean = false;

    private dragStart?: any;
    private dragging: boolean = false;
    private mousepos?: Point2D;
    private realMousepos?: Point2D;
    private visibleRect?: SimpleRect;

    public constructor() {
        $(document).on(
            'change.sdfv', '#sdfg-access-timeline-file-input',
            this.loadAccessTimeline.bind(this)
        );

        this.canvas = document.createElement('canvas');
        this.canvas.id = 'timeline-canvas';
        this.canvas.classList.add('sdfg_canvas');
        this.canvas.style.backgroundColor = 'inherit';
        $('#timeline-contents')[0].append(this.canvas);

        this.ctx = this.canvas.getContext('2d')!;
        this.canvasManager = new CanvasManager(this.ctx, this, this.canvas);
        this.backgroundColor = window.getComputedStyle(
            this.canvas
        ).backgroundColor;
        this.onresize();

        const br = () => this.canvas.getBoundingClientRect();

        const compX = (event: any): number => {
            const left = br()?.left;
            return this.canvasManager.mapPixelToCoordsX(
                event.clientX - (left ? left : 0)
            );
        };
        const compY = (event: any): number => {
            const top = br()?.top;
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
                /*
                if (!this.in_vscode) {
                    x.stopPropagation();
                    x.preventDefault();
                }
                */
            });
        }
    }

    public loadAccessTimeline(changeEvent: any): void {
        if (changeEvent.target.files.length < 1)
            return;
        const file = changeEvent.target.files[0];
        if (!file)
            return;

        const fileReader = new FileReader();
        fileReader.onload = (e) => {
            const result = e.target?.result;

            if (result) {
                const packedResult = read_or_decompress(result);
                this.timeline = JSON.parse(packedResult[0]);
                if (this.timeline)
                    this.constructGraph();
                else
                    console.error('Failed to load statistics');
            }
        };
        fileReader.readAsArrayBuffer(file);
    }

    private constructGraph(): void {
        if (this.timeline)
            this.graph = new TimelineGraph(this.timeline);
        this.zoomToView();
        this.draw_async();
    }

    public draw_async(): void {
        this.canvasManager.draw_async();
    }

    public draw(dt: number | null): void {
        const curx = this.canvasManager.mapPixelToCoordsX(0);
        const cury = this.canvasManager.mapPixelToCoordsY(0);
        const canvasw = this.canvas.width;
        const canvash = this.canvas.height;
        let endx = null;
        if (canvasw)
            endx = this.canvasManager.mapPixelToCoordsX(canvasw);
        let endy = null;
        if (canvash)
            endy = this.canvasManager.mapPixelToCoordsY(canvash);
        const curw = (endx ? endx : 0) - (curx ? curx : 0);
        const curh = (endy ? endy : 0) - (cury ? cury : 0);

        this.visibleRect = {
            x: curx ? curx : 0,
            y: cury ? cury : 0,
            w: curw,
            h: curh,
        };

        this.graph?.draw(this, this.ctx);
    }

    public onMouseEvent(
        event: any,
        compXFunc: (event: any) => number,
        compYFunc: (event: any) => number,
        evtype: string = 'other'
    ): boolean {
        if (!this.graph)
            return false;

        let dirty = false;
        let elementFocusChanged = false;
        let selectionChanged = false;

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
            const oldMousepos = this.mousepos;
            this.mousepos = {
                x: compXFunc(event),
                y: compYFunc(event),
            };
            this.realMousepos = { x: event.clientX, y: event.clientY };

            if (this.dragStart && event.buttons & 1) {
                this.dragging = true;

                // Mouse move in panning mode
                if (this.visibleRect) {
                    this.canvasManager.translate(
                        event.movementX, event.movementY
                    );

                    // Mark for redraw
                    dirty = true;
                }
            } else if (this.dragStart && event.buttons & 4) {
                // Pan the view with the middle mouse button
                this.dragging = true;
                if (this.visibleRect) {
                    this.canvasManager.translate(
                        event.movementX, event.movementY
                    );
                    dirty = true;
                }
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
                if (this.visibleRect) {
                    const movX = (
                        event.touches[0].clientX -
                        this.dragStart.touches[0].clientX
                    );
                    const movY = (
                        event.touches[0].clientY -
                        this.dragStart.touches[0].clientY
                    );

                    this.canvasManager.translate(movX, movY);
                }
                this.dragStart = event;

                // Mark for redraw
                dirty = true;
                this.draw_async();
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

                if (this.visibleRect) {
                    // First, translate according to movement of center point
                    const movX = newCenter[0] - oldCenter[0];
                    const movY = newCenter[1] - oldCenter[1];

                    this.canvasManager.translate(movX, movY);

                    // Then scale
                    this.canvasManager.scale(
                        currentDistance / initialDistance, newCenter[0],
                        newCenter[1]
                    );
                }

                this.dragStart = event;

                // Mark for redraw
                dirty = true;
                this.draw_async();
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

        if (!this.mousepos)
            return true;

        if (dirty)
            this.draw_async();

        return false;
    }

    public onresize(): void {
        // Set canvas size
        if (this.canvas) {
            this.canvas.style.width = '99%';
            this.canvas.style.height = '99%';
            this.canvas.width = this.canvas.offsetWidth;
            this.canvas.height = this.canvas.offsetHeight;
        }
    }

    public zoomToView(
        animate: boolean = true, padding?: number, redraw: boolean = true
    ): void {
        if (!this.graph)
            return;

        let absPadding = 10;
        if (padding !== undefined)
            absPadding = padding;
        const startX = -absPadding;
        const startY = -(this.graph.height + absPadding);
        const bb = new DOMRect(
            startX, startY,
            this.graph.width + 2 * absPadding,
            this.graph.height + 2 * absPadding
        );
        this.canvasManager.set_view(bb, animate);

        if (redraw)
            this.draw_async();
    }

}

$(() => {
    new TimelineView();
});

