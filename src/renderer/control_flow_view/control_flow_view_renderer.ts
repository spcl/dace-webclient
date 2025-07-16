// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import {
    layoutEdgesForSequence,
    layoutSequence,
} from '../../layout/control_flow_view_layout';
import { SimpleRect } from '../../types';
import {
    HTMLCanvasRenderer,
} from 'rendure/src/renderer/core/html_canvas/html_canvas_renderer';
import {
    CFVConditional,
    CFVControlFlowBlock,
    CFVElement,
    CFVElementClasses,
    CFVSequence,
} from './control_flow_view_elements';


export class ControlFlowViewRenderer extends HTMLCanvasRenderer {

    private rootSequence?: CFVSequence;

    private selectedElement?: CFVElement;

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

        this.canvas.id = 'cf-view-canvas';

        this.onresize();
    }

    public set cfSequence(seq: CFVSequence | undefined) {
        this.rootSequence = seq;
    }

    public get cfSequence(): CFVSequence | undefined {
        return this.rootSequence;
    }

    public layout(): void {
        if (this.rootSequence) {
            layoutSequence(this.rootSequence);
            layoutEdgesForSequence(this.rootSequence, this);
        }
    }

    protected internalDraw(
        _dt?: number, _ctx?: CanvasRenderingContext2D
    ): void {
        this.rootSequence?.draw(this.mousePos);
    }

    public doForIntersectedElements(
        x: number, y: number, w: number, h: number,
        func: (el: CFVElement, cat: CFVElementClasses) => any
    ): void {
        if (!this.rootSequence)
            return;

        const doRecursive = (seq: CFVSequence) => {
            for (const child of seq.children) {
                if (child.intersect(x, y, w, h)) {
                    func(child, 'block');
                    if (child instanceof CFVSequence) {
                        doRecursive(child);
                    } else if (child instanceof CFVConditional) {
                        for (const branch of child.branches) {
                            const bSeq = branch[1];
                            if (bSeq.intersect(x, y, w, h)) {
                                func(bSeq, 'block');
                                for (const conn of bSeq.inConnectors) {
                                    if (conn.intersect(x, y, w, h))
                                        func(conn, 'connector');
                                }
                                for (const conn of bSeq.outConnectors) {
                                    if (conn.intersect(x, y, w, h))
                                        func(conn, 'connector');
                                }
                                doRecursive(bSeq);
                            }
                        }
                    }
                }

                for (const conn of child.inConnectors) {
                    if (conn.intersect(x, y, w, h))
                        func(conn, 'connector');
                }
                for (const conn of child.outConnectors) {
                    if (conn.intersect(x, y, w, h))
                        func(conn, 'connector');
                }
            }
        };

        if (this.rootSequence.intersect(x, y, w, h))
            func(this.rootSequence, 'block');
        doRecursive(this.rootSequence);

        if (this.selectedElement &&
            this.selectedElement instanceof CFVControlFlowBlock) {
            for (const conn of this.selectedElement.inConnectors) {
                for (const edge of conn.edges) {
                    if (edge.intersect(x, y, w, h))
                        func(edge, 'edge');
                }
            }
            for (const conn of this.selectedElement.outConnectors) {
                for (const edge of conn.edges) {
                    if (edge.intersect(x, y, w, h))
                        func(edge, 'edge');
                }
            }
        }
    }

    public elementsInRect(
        x: number, y: number, w: number, h: number
    ): Set<CFVElement> {
        const elements = new Set<CFVElement>();
        this.doForIntersectedElements(x, y, w, h, (elem, cat) => {
            elements.add(elem);
        });
        return elements;
    }

    private findElementsUnderCursor(mouseX: number, mouseY: number): {
        elements: Set<CFVElement>,
        foregroundElement?: CFVElement,
    } {
        // Find all elements under the cursor.
        const elements = this.elementsInRect(mouseX, mouseY, 0, 0);

        // The foreground element is the one with the smallest dimension, or
        // the one where the previously selected smallest one is their parent.
        let foregroundElement = undefined;
        let foregroundSurface = -1;
        for (const elem of elements) {
            const surface = elem.width * elem.height;
            if (foregroundSurface < 0 || surface < foregroundSurface) {
                foregroundElement = elem;
                foregroundSurface = surface;
            }
        }

        return { elements, foregroundElement };
    }

    protected _drawMinimapContents(): void {
        return;
    }

    protected initUI(): void {
        return;
    }

    protected registerMouseHandlers(): void {
        return;
    }

    public getContentsBoundingBox(): SimpleRect {
        if (this.rootSequence) {
            const topleft = this.rootSequence.topleft();
            return {
                x: topleft.x,
                y: topleft.y,
                w: this.rootSequence.width,
                h: this.rootSequence.height,
            };
        } else {
            return { x: 0, y: 0, w: 0, h: 0 };
        }
    }

}
