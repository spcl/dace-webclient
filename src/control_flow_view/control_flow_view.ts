// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';

import 'bootstrap';

import '../../scss/control_flow_view.scss';
import {
    checkCompatLoad,
    parse_sdfg,
    read_or_decompress,
} from '../utils/sdfg/json_serializer';
import { DataSubset, JsonSDFG, Point2D, SimpleRect } from '../types';
import {
    CFV_BasicBlock,
    CFV_Conditional,
    CFV_ControlFlowBlock,
    CFV_Element,
    CFV_ElementClasses,
    CFV_Loop,
    CFV_Sequence,
} from './renderer_elements';
import { CanvasManager } from './canvas_manager';


const CFV_SEQUENCE_MARGIN = 20;
const CFV_SEQUENCE_SPACING = 20;

export interface MemoryTimelineScope {
    label: string;
    scope: string;
    children: MemoryTimelineScope[];
    start_time: number;
    end_time: number;
}

export interface _JsonMemlet {
    type: 'Memlet';
    attributes: {
        data: string;
        guid: string;
        volume?: string;
        dynamic?: boolean;
        subset: DataSubset;
    };
}

export interface _JsonCFBlock {
    type: string;
    parent?: string;
    guid: string;
    inputs: Record<string, [_JsonMemlet, _JsonCFBlock[]]>;
    outputs: Record<string, [_JsonMemlet, _JsonCFBlock[]]>;
}

export interface _JsonCFBasicBlock extends _JsonCFBlock {
}

export interface _JsonCFSequence extends _JsonCFBlock {
    children: _JsonCFBlock[];
}

export interface _JsonCFLoop extends _JsonCFSequence {
    parallel: boolean;
    cond: string;
    itvar?: string;
    init?: string;
    update?: string;
    nexec?: string;
}

export interface _JsonCFConditional extends _JsonCFBlock {
    branches: [string, _JsonCFSequence][];
}

export class ControlFlowView {

    public readonly debugDraw: boolean = true;

    private sdfg?: JsonSDFG;
    private rootSequence?: CFV_Sequence;

    private readonly canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private readonly canvasManager: CanvasManager;
    public readonly backgroundColor: string;

    private dragStart?: any;
    private dragging: boolean = false;
    private mousepos?: Point2D;
    private realMousepos?: Point2D;
    private visibleRect?: SimpleRect;
    private hoveredElement?: CFV_Element;

    protected tooltipContainer?: JQuery<HTMLDivElement>;
    protected tooltipText?: JQuery<HTMLSpanElement>;

    private readonly container: JQuery<HTMLElement>;

    public constructor() {
        $(document).on(
            'change.sdfv', '#sdfg-file-input',
            this.loadSDFG.bind(this)
        );
        $(document).on(
            'change.sdfv', '#control-flow-report-file-input',
            this.loadControlFlowReport.bind(this)
        );

        this.canvas = document.createElement('canvas');
        this.canvas.id = 'cf-view-canvas';
        this.canvas.classList.add('sdfg_canvas');
        this.canvas.style.backgroundColor = 'inherit';
        this.container = $('#cf-view-contents');
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

    public loadSDFG(changeEvent: any): void {
        if (changeEvent.target.files.length < 1)
            return;
        const file = changeEvent.target.files[0];
        if (!file)
            return;

        const fileReader = new FileReader();
        fileReader.onload = (e) => {
            const result = e.target?.result;

            if (result)
                this.sdfg = checkCompatLoad(parse_sdfg(result));
        };
        fileReader.readAsArrayBuffer(file);
    }

    private parseControlSequence(
        sequence: _JsonCFSequence, parent?: CFV_ControlFlowBlock
    ): CFV_Sequence {
        const result = (sequence.type === 'Loop' ?
            new CFV_Loop(sequence, parent) :
            new CFV_Sequence(sequence, parent));
        for (const block of sequence.children) {
            if (block.type === 'BasicBlock') {
                result.children.push(new CFV_BasicBlock(block, result));
            } else if (block.type === 'Conditional') {
                const conditional = new CFV_Conditional(block, result); 
                for (const b of (block as _JsonCFConditional).branches) {
                    const condition = b[0];
                    const branch = b[1];
                    const branchSequence = this.parseControlSequence(
                        branch, conditional
                    );
                    conditional.branches.push([condition, branchSequence]);
                }
                result.children.push(conditional);
            } else if (block.type === 'Loop') {
                const loop = this.parseControlSequence(
                    block as _JsonCFLoop, result
                );
                result.children.push(loop);
            }
        }
        return result;
    }

    public loadControlFlowReport(changeEvent: any): void {
        if (changeEvent.target.files.length < 1)
            return;
        const file = changeEvent.target.files[0];
        if (!file)
            return;

        const fileReader = new FileReader();
        fileReader.onload = (e) => {
            const result = e.target?.result;

            if (result) {
                this.rootSequence = this.parseControlSequence(
                    JSON.parse(read_or_decompress(result)[0])
                );
                this.layoutSequence(this.rootSequence);
                this.draw_async();
            }
        };
        fileReader.readAsArrayBuffer(file);
    }

    private layoutSequence(sequence: CFV_Sequence): void {
        let lastY = sequence.y + CFV_SEQUENCE_MARGIN;
        let lastX = sequence.x + CFV_SEQUENCE_MARGIN;
        let maxWidth = 0;
        for (const block of sequence.children) {
            block.y = lastY;
            block.x = lastX;
            if (block instanceof CFV_BasicBlock) {
                block.height = 50;
                block.width = 50;
            } else if (block instanceof CFV_Loop) {
                this.layoutSequence(block);
            } else if (block instanceof CFV_Conditional) {
                let maxHeight = 0;
                let totalWidth = 0;
                for (const branch of block.branches) {
                    branch[1].x = lastX + totalWidth;
                    branch[1].y = lastY;
                    this.layoutSequence(branch[1]);
                    totalWidth += branch[1].width;
                    if (branch[1].height > maxHeight)
                        maxHeight = branch[1].height;
                }
                block.height = maxHeight;
                block.width = totalWidth;
            }
            lastY += CFV_SEQUENCE_SPACING + block.height;
            if (block.width > maxWidth)
                maxWidth = block.width;
        }
        sequence.height = lastY - sequence.y;
        sequence.width = maxWidth + 2 * CFV_SEQUENCE_MARGIN;
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

        this.rootSequence?.draw(
            this, this.ctx, this.mousepos, this.realMousepos
        );

        if ((this.ctx as any).pdf)
            (this.ctx as any).end();
    }

    public doForIntersectedElements(
        x: number, y: number, w: number, h: number,
        func: (el: CFV_ControlFlowBlock, cat: CFV_ElementClasses) => any
    ): void {
        if (!this.rootSequence || !this.rootSequence.intersect(x, y, w, h))
            return;

        for (const child of this.rootSequence.children) {
            if (child.intersect(x, y, w, h))
                func(child, 'block');
        }
    }

    public elementsInRect(
        x: number, y: number, w: number, h: number
    ): Set<CFV_Element> {
        const elements = new Set<CFV_Element>();
        this.doForIntersectedElements(x, y, w, h, (elem, cat) => {
            elements.add(elem);
        });
        return elements;
    }

    private findElementsUnderCursor(mouseX: number, mouseY: number): {
        elements: Set<CFV_Element>,
        foregroundElement?: CFV_Element,
    } {
        // Find all elements under the cursor.
        const elements = this.elementsInRect(mouseX, mouseY, 0, 0);
        let foregroundElement = undefined;

        // TODO: find foreground element.

        return { elements, foregroundElement };
    }

    public onMouseEvent(
        event: any,
        compXFunc: (event: any) => number,
        compYFunc: (event: any) => number,
        evtype: string = 'other'
    ): boolean {
        if (!this.rootSequence)
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

    public showTooltip(x: number, y: number, text: string): void {
        this.hideTooltip();
        this.tooltipText = $('<span>', {
            class: 'cf-view-tooltip-text',
            text: text,
            css: {
                'white-space': 'pre-line',
            },
        });
        this.tooltipContainer = $('<div>', {
            class: 'cf-view-tooltip-container',
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

    public onresize(): void {
        // Set canvas size
        if (this.canvas) {
            this.canvas.style.width = '99%';
            this.canvas.style.height = '99%';
            this.canvas.width = this.canvas.offsetWidth;
            this.canvas.height = this.canvas.offsetHeight;
        }
    }

}

$(() => {
    const viewer = new ControlFlowView();
});
