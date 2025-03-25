// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';

import 'bootstrap';

import '../../scss/access_timeline.scss';
import { DataSubset, JsonSDFG, JsonSDFGConditionalBlock, JsonSDFGControlFlowRegion, JsonSDFGState, Point2D, SimpleRect } from '../types';
import { checkCompatLoad, parse_sdfg, read_or_decompress } from '../utils/sdfg/json_serializer';
import { CanvasManager } from './canvas_manager';
import {
    AllocatedContainer,
    ContainerAccess,
    TimelineChart,
    TimelineViewElement,
    TimelineViewElementClasses,
} from './renderer_elements';

declare const blobStream: any;
declare const canvas2pdf: any;

export interface MemoryTimelineScope {
    label: string;
    scope: string;
    children: MemoryTimelineScope[];
    start_time: number;
    end_time: number;
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
    subset: DataSubset;
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

    public sdfg?: JsonSDFG;
    public sdfg_list: Map<number, JsonSDFG> = new Map();

    private timeline: MemoryEvent[] | null = null;
    private scopes: MemoryTimelineScope[] | null = null;
    private chart?: TimelineChart;

    private readonly canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private readonly canvasManager: CanvasManager;
    public readonly backgroundColor: string;
    public readonly debugDraw: boolean = false;

    private dragStart?: any;
    private dragging: boolean = false;
    private mousepos?: Point2D;
    private realMousepos?: Point2D;
    private visibleRect?: SimpleRect;
    private hoveredElement?: TimelineViewElement;

    protected tooltipContainer?: JQuery<HTMLDivElement>;
    protected tooltipText?: JQuery<HTMLSpanElement>;

    private readonly container: JQuery<HTMLElement>;

    // Determine whether rendering only happens in the viewport or also outside.
    protected _viewportOnly: boolean = true;
    // Determine whether content should adaptively be hidden when zooming out.
    // Controlled by the SDFVSettings.
    protected _adaptiveHiding: boolean = true;

    public constructor() {
        $(document).on(
            'change.sdfv', '#sdfg-file-input',
            this.loadSDFG.bind(this)
        );
        $(document).on(
            'change.sdfv', '#sdfg-access-timeline-file-input',
            this.loadAccessTimeline.bind(this)
        );
        $('#save-access-timeline-as-pdf-btn').on(
            'click', () => { this.saveAsPDF(true) }
        );
        $('#save-access-timeline-view-as-pdf-btn').on(
            'click', () => { this.saveAsPDF(false) }
        );

        this.canvas = document.createElement('canvas');
        this.canvas.id = 'timeline-canvas';
        this.canvas.classList.add('sdfg_canvas');
        this.canvas.style.backgroundColor = 'inherit';
        this.container = $('#timeline-contents');
        this.container[0].append(this.canvas);

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

    private recursivelyRegisterSDFGs(cfg: JsonSDFGControlFlowRegion): void {
        if (cfg.type === 'SDFG')
            this.sdfg_list.set(cfg.cfg_list_id, cfg as JsonSDFG);

        for (const node of cfg.nodes) {
            if (node.type === 'SDFGState') {
                for (const nd of (node as JsonSDFGState).nodes) {
                    if (nd.type === 'NestedSDFG') {
                        this.recursivelyRegisterSDFGs(
                            (nd as any).attributes.sdfg
                        );
                    }
                }
            } else if (node.type === 'ConditionalBlock') {
                for (const brn of (node as JsonSDFGConditionalBlock).branches)
                    this.recursivelyRegisterSDFGs(brn[1]);
            } else if (Object.hasOwn(node, 'nodes')) {
                this.recursivelyRegisterSDFGs(
                    node as JsonSDFGControlFlowRegion
                );
            }
        }
    }

    public loadSDFG(changeEvent: any): void {
        if (changeEvent.target.files.length < 1)
            return;
        const file = changeEvent.target.files[0];
        if (!file)
            return;

        const fileReader = new FileReader();
        fileReader.onload = (e) => {
            const result = e.target?.result;

            if (result) {
                this.sdfg = checkCompatLoad(parse_sdfg(result));
                if (this.sdfg)
                    this.recursivelyRegisterSDFGs(this.sdfg);
            }
        };
        fileReader.readAsArrayBuffer(file);
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
                const data = JSON.parse(packedResult[0]);
                this.timeline = data['events'];
                this.scopes = data['scopes'];
                if (this.timeline && this.scopes)
                    this.constructChart();
                else
                    console.error('Failed to load statistics');
            }
        };
        fileReader.readAsArrayBuffer(file);
    }

    private constructChart(): void {
        if (this.timeline && this.scopes)
            this.chart = new TimelineChart(this.timeline, this.scopes[0], this);
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

        this.chart?.draw(this, this.ctx, this.mousepos, this.realMousepos);

        if ((this.ctx as any).pdf)
            (this.ctx as any).end();
    }

    public doForIntersectedElements(
        x: number, y: number, w: number, h: number,
        func: (el: TimelineViewElement, cat: TimelineViewElementClasses) => any
    ): void {
        if (!this.chart || !this.chart.intersect(x, y, w, h))
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
        this.doForIntersectedElements(x, y, w, h, (elem, cat) => {
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
        if (!foregroundElement)
            foregroundElement = elements.values().next().value;

        return { elements, foregroundElement };
    }

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

        const elementsUnderCursor = this.findElementsUnderCursor(
            this.mousepos.x, this.mousepos.y
        );

        if (elementsUnderCursor.foregroundElement) {
            if (elementsUnderCursor.foregroundElement != this.hoveredElement) {
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
        if (!this.chart)
            return;

        let absPadding = 10;
        if (padding !== undefined)
            absPadding = padding;
        const startX = -absPadding;
        const startY = -(this.chart.height + absPadding);
        const bb = new DOMRect(
            startX, startY,
            this.chart.width + 2 * absPadding,
            this.chart.height + 2 * absPadding
        );
        this.canvasManager.set_view(bb, animate);

        if (redraw)
            this.draw_async();
    }

    public showTooltip(x: number, y: number, text: string): void {
        this.hideTooltip();
        this.tooltipText = $('<span>', {
            class: 'timeline-tooltip-text',
            text: text,
            css: {
                'white-space': 'pre-line',
            },
        });
        this.tooltipContainer = $('<div>', {
            class: 'timeline-tooltip-container',
            css: {
                left: '0px',
                top: '0px',
            },
        });
        this.tooltipText.appendTo(this.tooltipContainer);
        this.tooltipContainer.appendTo($(document.body));
        const bcr = this.tooltipContainer[0].getBoundingClientRect();
        const containerBcr = this.container[0].getBoundingClientRect();
        this.tooltipContainer.css(
            'left', (x - bcr.width / 2).toString() + 'px'
        );
        this.tooltipContainer.css(
            'top',
            (((y + containerBcr.y) - (bcr.height / 2)) - 8).toString() + 'px'
        );
    }

    public hideTooltip(): void {
        if (this.tooltipContainer)
            this.tooltipContainer.remove();
    }

    public save(filename: string, contents: string | undefined): void {
        if (!contents)
            return;
        const link = document.createElement('a');
        link.setAttribute('download', filename);
        link.href = contents;
        document.body.appendChild(link);

        // wait for the link to be added to the document
        window.requestAnimationFrame(() => {
            const event = new MouseEvent('click');
            link.dispatchEvent(event);
            document.body.removeChild(link);
        });
    }

    public saveAsPDF(saveAll = false): void {
        if (!this.chart)
            return;

        const stream = blobStream();

        // Compute document size
        const curx = this.canvasManager.mapPixelToCoordsX(0);
        const cury = this.canvasManager.mapPixelToCoordsY(0);
        let size;
        if (saveAll) {
            // Get size of entire graph
            size = [this.chart.width, this.chart.height];
        } else {
            // Get size of current view
            const canvasw = this.canvas?.width;
            const canvash = this.canvas?.height;
            let endx = null;
            if (canvasw)
                endx = this.canvasManager.mapPixelToCoordsX(canvasw);
            let endy = null;
            if (canvash)
                endy = this.canvasManager.mapPixelToCoordsY(canvash);
            const curw = (endx ? endx : 0) - (curx ? curx : 0);
            const curh = (endy ? endy : 0) - (cury ? cury : 0);
            size = [curw, curh];
        }

        const ctx = new canvas2pdf.PdfContext(stream, { size: size });
        const oldctx = this.ctx;
        this.ctx = ctx;

        (this.ctx as any).pdf = true;
        // Center on saved region
        if (!saveAll)
            this.ctx.translate(-(curx ? curx : 0), -(cury ? cury : 0));
        else
            this.ctx.translate(0, this.chart.yAxis.height);

        this.draw_async();

        ctx.stream.on('finish', () => {
            this.save(
                'timeline.pdf',
                ctx.stream.toBlobURL('application/pdf')
            );
            this.ctx = oldctx;
            this.draw_async();
        });
    }

}

$(() => {
    new TimelineView();
});

