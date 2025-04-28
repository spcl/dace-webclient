// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';

import EventEmitter from 'events';
import { CanvasManager } from './canvas_manager';
import type { Point2D, SimpleRect } from '../../types';

// External, non-typescript libraries which are presented as previously loaded
// scripts and global javascript variables:
declare const blobStream: any;
declare const canvas2pdf: any;

// Some global functions and variables which are only accessible within VSCode:
declare const vscode: any | null;

export interface HTMLCanvasRendererEvent {
}

/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
export interface HTMLCanvasRenderer {

    on<U extends keyof HTMLCanvasRendererEvent>(
        event: U, listener: HTMLCanvasRendererEvent[U]
    ): this;

    emit<U extends keyof HTMLCanvasRendererEvent>(
        event: U, ...args: Parameters<HTMLCanvasRendererEvent[U]>
    ): boolean;

}

/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
export abstract class HTMLCanvasRenderer extends EventEmitter {

    public readonly canvas: HTMLCanvasElement;
    public readonly canvasManager: CanvasManager;
    public readonly ctx: CanvasRenderingContext2D;
    public readonly pdfCtx?: CanvasRenderingContext2D;

    // Indicate whether the renderer runs inside of VSCode.
    public readonly inVSCode: boolean = false;

    // Mouse-related fields.
    // Last position of the mouse pointer (in canvas coordinates).
    protected mousePos: Point2D | null = null;
    // Last position of the mouse pointer (in pixel coordinates).
    protected realMousePos: Point2D | null = null;
    protected dragging: boolean = false;
    protected tooltipContainer?: JQuery<HTMLDivElement>;
    protected tooltipText?: JQuery<HTMLSpanElement>;
    // Null if the mouse/touch is not activated.
    protected dragStart: any = null;

    // Debug information window fields.
    protected dbgInfoBox: JQuery<HTMLElement> | null = null;
    protected dbgMouseCoords: JQuery<HTMLElement> | null = null;

    // Determine whether rendering only happens in the viewport or also outside.
    protected _viewportOnly: boolean = true;
    // Determine whether content should adaptively be hidden when zooming out.
    // Controlled by the settings.
    protected _adaptiveHiding: boolean = true;

    public constructor(
        protected container: JQuery<HTMLElement>,
        protected extMouseHandler: (
            (...args: any[]) => boolean
        ) | null = null,
        protected initialUserTransform: DOMMatrix | null = null,
        protected backgroundColor: string | null = null,
        public debugDraw = false,
    ) {
        super();

        this.inVSCode = false;
        try {
            vscode;
            if (vscode)
                this.inVSCode = true;
        } catch (ex) { }

        // Initialize the DOM.
        this.canvas = document.createElement('canvas');
        this.canvas.classList.add('sdfv_canvas');
        if (this.backgroundColor)
            this.canvas.style.backgroundColor = this.backgroundColor;
        else
            this.canvas.style.backgroundColor = 'inherit';
        this.container[0].append(this.canvas);

        // Set inherited background.
        if (!this.backgroundColor) {
            this.backgroundColor =
                window.getComputedStyle(this.canvas).backgroundColor;
        }

        // Initialize debug drawing, if requested.
        if (this.debugDraw) {
            this.dbgInfoBox = $('div', {
                css: {
                    position: 'absolute',
                    bottom: '.5rem',
                    right: '.5rem',
                    backgroundColor: 'black',
                    padding: '.3rem',
                },
            });
            this.dbgMouseCoords = $('span', {
                css: {
                    color: 'white',
                    fontSiye: '1rem',
                    innerText: 'x: N/A | y: N/A',
                }
            });
            this.dbgInfoBox.append(this.dbgMouseCoords);
            this.container.append(this.dbgInfoBox);
        }

        const rCtx = this.canvas.getContext('2d', { desynchronized: true });
        if (!rCtx)
            throw Error('Failed to obtain the canvas rendering context');
        this.ctx = rCtx;

        if (this.canSaveToPDF) {
            const stream = blobStream();
            this.pdfCtx = new canvas2pdf.PdfContext(stream)
        }

        // Set up translation/scaling management.
        this.canvasManager = new CanvasManager(this.ctx, this, this.canvas);
        if (this.initialUserTransform !== null)
            this.canvasManager.set_user_transform(this.initialUserTransform);

        // Observe resize events for the canvas and its container.
        const observer = new MutationObserver(() => {
            this.onresize();
            this.drawAsync();
        });
        observer.observe(this.container[0], { attributes: true });
        const resizeObserver = new ResizeObserver(() => {
            this.onresize();
            this.drawAsync();
        });
        resizeObserver.observe(this.container[0]);

        // Set mouse event handlers.
        this.registerMouseHandler();

        // UI initialization.
        this.initUI();

        // Set initial zoom, if not already set.
        if (this.initialUserTransform === null)
            this.zoomToFitContents();
    }

    public destroy(): void {
        try {
            this.canvasManager?.destroy();
            this.canvas?.remove();
        } catch (ex) {
            // Do nothing
        }
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

    protected abstract initUI(): void;

    public drawAsync(): void {
        this.canvasManager?.draw_async();
    }

    private registerMouseHandler(): void {
        const canvas = this.canvas;
        const br = () => canvas?.getBoundingClientRect();

        const posCompX = (event: any): number | undefined => {
            const left = br()?.left;
            return this.canvasManager?.mapPixelToCoordsX(
                event.clientX - (left ? left : 0)
            );
        };
        const posCompY = (event: any): number | undefined => {
            const top = br()?.top;
            return this.canvasManager?.mapPixelToCoordsY(
                event.clientY - (top ? top : 0)
            );
        };

        /*
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
            canvas?.addEventListener(evtype, x => {
                const cancelled = this.onMouseEvent(
                    x, posCompX, posCompY, evtype
                );
                if (cancelled)
                    return;
                if (!this.inVSCode) {
                    x.stopPropagation();
                    x.preventDefault();
                }
            });
        }
            */
    }

    public onresize(): void {
        // Update the canvas size.
        if (this.canvas) {
            this.canvas.style.width = '99%';
            this.canvas.style.height = '99%';
            this.canvas.width = this.canvas.offsetWidth;
            this.canvas.height = this.canvas.offsetHeight;
        }
    }

    public get canSaveToPDF(): boolean {
        try {
            blobStream;
            canvas2pdf.PdfContext;
            return true;
        } catch (e) {
            return false;
        }
    }

    // Draw a debug grid on the canvas to indicate coordinates.
    public drawDebugGrid(
        curx: number, cury: number, endx: number, endy: number,
        gridWidth: number = 100
    ): void {
        if (!this.ctx)
            return;

        const limXMin = Math.floor(curx / gridWidth) * gridWidth;
        const limXMax = Math.ceil(endx / gridWidth) * gridWidth;
        const limYMin = Math.floor(cury / gridWidth) * gridWidth;
        const limYMax = Math.ceil(endy / gridWidth) * gridWidth;
        for (let i = limXMin; i <= limXMax; i += gridWidth) {
            this.ctx.moveTo(i, limYMin);
            this.ctx.lineTo(i, limYMax);
        }
        for (let i = limYMin; i <= limYMax; i += gridWidth) {
            this.ctx.moveTo(limXMin, i);
            this.ctx.lineTo(limXMax, i);
        }
        this.ctx.strokeStyle = 'yellow';
        this.ctx.stroke();

        // Draw the zero-point.
        this.ctx.beginPath();
        this.ctx.arc(0, 0, 10, 0, 2 * Math.PI, false);
        this.ctx.fillStyle = 'red';
        this.ctx.fill();
        this.ctx.strokeStyle = 'red';
        this.ctx.stroke();
    }

    protected abstract internalDraw(dt: number | null): void;

    public draw(dt: number | null): void {
        this.onPreDraw();

        this.internalDraw(dt);

        if (this.debugDraw) {
            this.drawDebugGrid(
                this.canvasManager.viewport.x,
                this.canvasManager.viewport.y,
                this.canvasManager.viewport.w,
                this.canvasManager.viewport.h,
                100
            );

            if (this.dbgMouseCoords) {
                if (this.mousePos) {
                    this.dbgMouseCoords.text(
                        'x: ' + Math.floor(this.mousePos.x) +
                        ' | y: ' + Math.floor(this.mousePos.y)
                    );
                } else {
                    this.dbgMouseCoords.text('x: N/A | y: N/A');
                }
            }
        }

        this.onPostDraw();
    }

    private onPreDraw(): void {
    }

    private onPostDraw(): void {
        // TODO: This should be PDF only?
        try {
            (this.ctx as any).end();
        } catch (ex) {
            // TODO: make sure no error is thrown instead of catching and
            // silently ignoring it?
        }
    }

    public moveViewTo(x: number, y: number): void {
        const targetRect = new DOMRect(
            x - (this.viewport.w / 2),
            y - (this.viewport.h / 2),
            this.viewport.w,
            this.viewport.h
        );
        this.canvasManager?.set_view(targetRect, true);
        this.drawAsync();
    }

    public abstract zoomToFitContents(
        animate?: boolean, padding?: number, redraw?: boolean
    ): void;

    public registerExternalMouseHandler(
        handler: ((...args: any[]) => boolean) | null
    ): void {
        this.extMouseHandler = handler;
    }

    public getCanvas(): HTMLCanvasElement | null {
        return this.canvas;
    }

    public getCanvasManager(): CanvasManager | null {
        return this.canvasManager;
    }

    public getContext(): CanvasRenderingContext2D | null {
        return this.ctx;
    }

    public getViewport(): SimpleRect | null {
        return this.viewport;
    }

    public getBackgroundColor(): string {
        return (this.backgroundColor ? this.backgroundColor : '');
    }

    public getMousePos(): Point2D | null {
        return this.mousePos;
    }

    public setBackgroundColor(backgroundColor: string): void {
        this.backgroundColor = backgroundColor;
    }

    public get viewportOnly(): boolean {
        return this._viewportOnly;
    }

    public get adaptiveHiding(): boolean {
        return this._adaptiveHiding;
    }

    public get viewport(): SimpleRect {
        return this.canvasManager.viewport;
    }

}

