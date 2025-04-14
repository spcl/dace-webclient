// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { Point2D } from '../types';
import { sdfg_property_to_string } from '../utils/sdfg/display';
import { SDFVSettings } from '../utils/sdfv_settings';
import {
    _JsonCFBasicBlock,
    _JsonCFBlock,
    _JsonCFLoop,
    _JsonCFSequence,
    _JsonMemlet,
    ControlFlowView,
} from './control_flow_view';


export type CFV_ElementClasses = 'block' | 'edge' | 'connector';

export class CFV_Element {

    // Indicate special drawing conditions based on interactions.
    protected selected: boolean = false;
    public highlighted: boolean = false;
    public hovered: boolean = false;

    public x: number = 0;
    public y: number = 0;
    public width: number = 0;
    public height: number = 0;

    public deselect(): void {
        this.selected = false;
    }

    public select(renderer: ControlFlowView): void {
        this.selected = true;
    }

    public draw(
        _renderer: ControlFlowView, _ctx: CanvasRenderingContext2D,
        _mousepos?: Point2D, _realMousepos?: Point2D
    ): void {
        return;
    }

    public simpleDraw(
        _renderer: ControlFlowView, _ctx: CanvasRenderingContext2D,
        _mousepos?: Point2D, _realMousepos?: Point2D
    ): void {
        return;
    }

    public shade(
        _renderer: ControlFlowView, _ctx: CanvasRenderingContext2D,
        _color: string, _alpha: number = 0.4
    ): void {
        return;
    }

    public debugDraw(
        renderer: ControlFlowView, ctx: CanvasRenderingContext2D
    ): void {
        if (renderer.debugDraw) {
            // Print the center and bounding box in debug mode.
            ctx.beginPath();
            ctx.arc(this.x, this.y, 1, 0, 2 * Math.PI, false);
            ctx.fillStyle = 'red';
            ctx.fill();
            ctx.strokeStyle = 'red';
            ctx.stroke();
            ctx.strokeRect(
                this.x - (this.width / 2.0), this.y - (this.height / 2.0),
                this.width, this.height
            );
        }
    }

    // Produces HTML for a hover-tooltip
    public tooltip(container: HTMLElement): void {
        container.className = 'sdfvtooltip';
    }

    public topleft(): Point2D {
        return { x: this.x - this.width / 2, y: this.y - this.height / 2 };
    }

    // General bounding-box intersection function. Returns true iff point or
    // rectangle intersect element.
    public intersect(
        x: number, y: number, w: number = 0, h: number = 0
    ): boolean {
        if (w === 0 || h === 0) {  // Point-element intersection
            return (x >= this.x) && (x <= this.x + this.width) &&
                (y >= this.y) && (y <= this.y + this.height);
        } else {                 // Box-element intersection
            return (x <= this.x) && (x + w >= this.x - this.width) &&
                (y <= this.y) && (y + h >= this.y - this.height);
        }
    }

    public contained_in(
        x: number, y: number, w: number = 0, h: number = 0
    ): boolean {
        if (w === 0 || h === 0)
            return false;

        const box_start_x = x;
        const box_end_x = x + w;
        const box_start_y = y;
        const box_end_y = y + h;

        const el_start_x = this.x - (this.width / 2.0);
        const el_end_x = this.x + (this.width / 2.0);
        const el_start_y = this.y - (this.height / 2.0);
        const el_end_y = this.y + (this.height / 2.0);

        return box_start_x <= el_start_x &&
            box_end_x >= el_end_x &&
            box_start_y <= el_start_y &&
            box_end_y >= el_end_y;
    }

    public get isSelected(): boolean {
        return this.selected;
    }

}

export class CFV_DepEdge extends CFV_Element {

    public points: Point2D[] = [];

    public constructor(
        public label: string,
        public readonly memlet: _JsonMemlet,
        public readonly src: CFV_ControlFlowBlock,
        public readonly dst: CFV_ControlFlowBlock,
        public readonly includeSubset: boolean = false,
    ) {
        super();
    }

    protected drawArrow(
        ctx: CanvasRenderingContext2D, p1: Point2D, p2: Point2D, size: number,
        offset: number = 0, padding: number = 0
    ): void {
        // Rotate the context to point along the path
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const rot = Math.atan2(dy, dx);
        ctx.translate(p2.x, p2.y);
        ctx.rotate(rot);

        // arrowhead
        ctx.beginPath();
        ctx.moveTo(0 + padding + offset, 0);
        ctx.lineTo(((-2 * size) - padding) - offset, -(size + padding));
        ctx.lineTo(((-2 * size) - padding) - offset, (size + padding));
        ctx.closePath();
        ctx.fill();

        // Restore context
        ctx.rotate(-rot);
        ctx.translate(-p2.x, -p2.y);
    }

    public draw(
        renderer: ControlFlowView, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, realMousepos?: Point2D
    ): void {
        ctx.beginPath();
        ctx.moveTo(this.points[0].x, this.points[0].y);
        for (let i = 1; i < this.points.length; i++)
            ctx.lineTo(this.points[i].x, this.points[i].y);
        ctx.fillStyle = ctx.strokeStyle = 'blue';
        ctx.setLineDash([1, 0]);
        ctx.stroke();

        this.drawArrow(
            ctx, this.points[this.points.length - 2],
            this.points[this.points.length - 1], 3
        );

        if (this.hovered && realMousepos) {
            if (this.includeSubset) {
                const subsetString = sdfg_property_to_string(
                    this.memlet.attributes.subset, SDFVSettings.settingsDict
                );
                const tooltipText = this.label + ' ' + subsetString;
                renderer.showTooltip(
                    realMousepos.x, realMousepos.y, tooltipText
                );
            } else {
                renderer.showTooltip(
                    realMousepos.x, realMousepos.y, this.label
                );
            }
        }
    }

    public intersect(
        x: number, y: number, w: number = 0, h: number = 0
    ): boolean {
        // First, check bounding box
        if (!super.intersect(x, y, w, h))
            return false;

        if (w === 0 || h === 0) {
            for (let i = 0; i < this.points.length - 1; i++) {
                const dist = ptLineDistance(
                    { x: x, y: y }, this.points[i], this.points[i + 1]
                );
                if (dist <= 2.0)
                    return true;
            }
            return false;
        } else {
            // It is a rectangle. Check if any of the rectangles, spanned by
            // pairs of points of the line, intersect the input rectangle.
            // This is needed for long Interstate edges that have a huge
            // bounding box and intersect almost always with the viewport even
            // if they are not visible. This is only an approximation to detect
            // if a line is in the viewport and could be made more accurate at
            // the cost of more computation.
            for (let i = 0; i < this.points.length - 1; i++) {
                const linepoint_0 = this.points[i];
                const linepoint_1 = this.points[i + 1];
                // Rectangle spanned by the two line points
                const r = {
                    x: Math.min(linepoint_0.x, linepoint_1.x),
                    y: Math.min(linepoint_0.y, linepoint_1.y),
                    w: Math.abs(linepoint_1.x - linepoint_0.x),
                    h: Math.abs(linepoint_1.y - linepoint_0.y),
                };

                // Check if the two rectangles intersect
                if (r.x + r.w >= x && r.x <= x + w &&
                    r.y + r.h >= y && r.y <= y + h)
                    return true;
            }
            return false;
        }
    }

}

export class CFV_DepConnector extends CFV_Element {

    protected readonly color: string = 'black';

    public edges: CFV_DepEdge[] = [];

    public constructor(
        public readonly dataName: string,
    ) {
        super();
    }

    public draw(
        renderer: ControlFlowView, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, realMousepos?: Point2D
    ): void {
        ctx.beginPath();
        drawEllipse(ctx, this.x, this.y, this.width, this.height);
        ctx.closePath();
        ctx.fillStyle = this.color;
        ctx.fill();
    }

}

export class CFV_ControlFlowBlock extends CFV_Element {

    protected readonly color: string = 'black';
    public inConnectors: CFV_DepConnector[] = [];
    public outConnectors: CFV_DepConnector[] = [];

    public constructor(
        public readonly data: _JsonCFBlock,
        public readonly parent?: CFV_ControlFlowBlock,
    ) {
        super();
    }

    public draw(
        renderer: ControlFlowView, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, realMousepos?: Point2D
    ): void {
        ctx.strokeStyle = this.color;
        ctx.strokeRect(this.x, this.y, this.width, this.height);

        for (const icon of this.inConnectors)
            icon.draw(renderer, ctx, mousepos, realMousepos);
        for (const ocon of this.outConnectors)
            ocon.draw(renderer, ctx, mousepos, realMousepos);

        if (this.selected) {
            ctx.fillStyle = this.color;
            const oldAlpha = ctx.globalAlpha;
            ctx.globalAlpha = 0.2;
            ctx.fillRect(this.x, this.y, this.width, this.height);
            ctx.globalAlpha = oldAlpha;

            for (const icon of this.inConnectors) {
                for (const edge of icon.edges)
                    edge.draw(renderer, ctx, mousepos, realMousepos);
            }
            for (const ocon of this.outConnectors) {
                for (const edge of ocon.edges)
                    edge.draw(renderer, ctx, mousepos, realMousepos);
            }
        }

        if (this.hovered) {
            ctx.fillStyle = this.color;
            const oldAlpha = ctx.globalAlpha;
            ctx.globalAlpha = 0.1;
            ctx.fillRect(this.x, this.y, this.width, this.height);
            ctx.globalAlpha = oldAlpha;
        }
    }

}

export class CFV_BasicBlock extends CFV_ControlFlowBlock {

    protected readonly color: string = 'gray';

}

export class CFV_Sequence extends CFV_ControlFlowBlock {

    public readonly children: CFV_ControlFlowBlock[] = [];

    protected readonly color: string = 'gray';
    protected collapsed: boolean = false;

    private _isRoot: boolean = false;

    public constructor(data: _JsonCFSequence, parent?: CFV_ControlFlowBlock) {
        super(data, parent);
        if (parent === undefined) {
            this.collapsed = false;
            this._isRoot = true;
        }
    }

    public draw(
        renderer: ControlFlowView, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, realMousepos?: Point2D
    ): void {
        if (!this._isRoot)
            super.draw(renderer, ctx, mousepos, realMousepos);

        if (this.collapsed) {
            const plusCenterY = this.y + this.height / 2;
            const plusCenterX = this.x + this.width / 2;
            ctx.beginPath();
            ctx.moveTo(plusCenterX, plusCenterY - 20);
            ctx.lineTo(plusCenterX, plusCenterY + 20);
            ctx.moveTo(plusCenterX - 20, plusCenterY);
            ctx.lineTo(plusCenterX + 20, plusCenterY);
            ctx.stroke();
        } else {
            for (const child of this.children)
                child.draw(renderer, ctx, mousepos, realMousepos);
        }
    }

    public toggleCollapse(): void {
        if (this._isRoot)
            return;
        this.collapsed = !this.collapsed;
    }

    public get isCollapsed(): boolean {
        return this.collapsed;
    }

}

export class CFV_Loop extends CFV_Sequence {

    protected readonly color: string = 'red';

    public draw(
        renderer: ControlFlowView, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, realMousepos?: Point2D
    ): void {
        const color = (this.data as _JsonCFLoop).parallel ? 'green' : 'red';
        ctx.strokeStyle = color;
        ctx.strokeRect(this.x, this.y, this.width, this.height);

        for (const icon of this.inConnectors)
            icon.draw(renderer, ctx, mousepos, realMousepos);
        for (const ocon of this.outConnectors)
            ocon.draw(renderer, ctx, mousepos, realMousepos);

        if (this.selected) {
            ctx.fillStyle = color;
            const oldAlpha = ctx.globalAlpha;
            ctx.globalAlpha = 0.2;
            ctx.fillRect(this.x, this.y, this.width, this.height);
            ctx.globalAlpha = oldAlpha;

            for (const icon of this.inConnectors) {
                for (const edge of icon.edges)
                    edge.draw(renderer, ctx, mousepos, realMousepos);
            }
            for (const ocon of this.outConnectors) {
                for (const edge of ocon.edges)
                    edge.draw(renderer, ctx, mousepos, realMousepos);
            }
        }

        if (this.hovered) {
            ctx.fillStyle = color;
            const oldAlpha = ctx.globalAlpha;
            ctx.globalAlpha = 0.1;
            ctx.fillRect(this.x, this.y, this.width, this.height);
            ctx.globalAlpha = oldAlpha;
        }

        if (this.collapsed) {
            const plusCenterY = this.y + this.height / 2;
            const plusCenterX = this.x + this.width / 2;
            ctx.beginPath();
            ctx.moveTo(plusCenterX, plusCenterY - 20);
            ctx.lineTo(plusCenterX, plusCenterY + 20);
            ctx.moveTo(plusCenterX - 20, plusCenterY);
            ctx.lineTo(plusCenterX + 20, plusCenterY);
            ctx.stroke();
        } else {
            for (const child of this.children)
                child.draw(renderer, ctx, mousepos, realMousepos);
        }

        const rangesString = (this.data as _JsonCFLoop).ranges;
        if (rangesString !== undefined) {
            ctx.fillStyle = 'black';
            ctx.fillText(rangesString, this.x + this.width / 2, this.y + 10);
        }
    }

}

export class CFV_Conditional extends CFV_ControlFlowBlock {

    public readonly branches: [string, CFV_Sequence][] = [];
    protected readonly color: string = 'blue';

    protected collapsed: boolean = false;

    public draw(
        renderer: ControlFlowView, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, realMousepos?: Point2D
    ): void {
        super.draw(renderer, ctx, mousepos, realMousepos);
        if (this.collapsed) {
            const plusCenterY = this.y + this.height / 2;
            const plusCenterX = this.x + this.width / 2;
            ctx.beginPath();
            ctx.moveTo(plusCenterX, plusCenterY - 20);
            ctx.lineTo(plusCenterX, plusCenterY + 20);
            ctx.moveTo(plusCenterX - 20, plusCenterY);
            ctx.lineTo(plusCenterX + 20, plusCenterY);
            ctx.stroke();
        } else {
            for (const branch of this.branches)
                branch[1].draw(renderer, ctx, mousepos);
        }
    }

    public toggleCollapse(): void {
        this.collapsed = !this.collapsed;
    }

    public get isCollapsed(): boolean {
        return this.collapsed;
    }

}

export class CFV_Parallel extends CFV_ControlFlowBlock {

    public readonly sections: CFV_ControlFlowBlock[][] = [];

}

export class CFV_Irreducible extends CFV_ControlFlowBlock {
}

// Returns the distance from point p to line defined by two points
// (line1, line2)
function ptLineDistance(
    p: Point2D, line1: Point2D, line2: Point2D
): number {
    const dx = (line2.x - line1.x);
    const dy = (line2.y - line1.y);
    const res = dy * p.x - dx * p.y + line2.x * line1.y - line2.y * line1.x;

    return Math.abs(res) / Math.sqrt(dy * dy + dx * dx);
}

function drawEllipse(
    ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number
): void {
    if ((ctx as any).pdf) {
        // The PDF rendering context does not have an `ellipse` function. As
        // such, we revert back to the non-GPU-accelerated method of drawing
        // ellipses that we used up to and including commit 2ceba1d.
        // Adapted from https://stackoverflow.com/a/2173084/6489142
        const kappa = .5522848
        const ox = (w / 2) * kappa;
        const oy = (h / 2) * kappa;
        const xe = x + w;
        const ye = y + h;
        const xm = x + (w / 2);
        const ym = y + (h / 2);
        ctx.moveTo(x, ym);
        ctx.bezierCurveTo(x, ym - oy, xm - ox, y, xm, y);
        ctx.bezierCurveTo(xm + ox, y, xe, ym - oy, xe, ym);
        ctx.bezierCurveTo(xe, ym + oy, xm + ox, ye, xm, ye);
        ctx.bezierCurveTo(xm - ox, ye, x, ym + oy, x, ym);
    } else {
        // When drawing on a regular canvas, use the built-in method of drawing
        // ellipses to utilize GPU acceleration where available.
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, 2 * Math.PI);
    }
}
