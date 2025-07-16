// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import {
    ptLineDistance,
} from 'rendure/src/renderer/core/common/renderer_utils';
import { Point2D } from '../../types';
import { sdfgPropertyToString } from '../../utils/sdfg/display';
import { SDFVSettings } from '../../utils/sdfv_settings';
import type { ControlFlowViewRenderer } from './control_flow_view_renderer';
import {
    HTMLCanvasRenderable,
} from 'rendure/src/renderer/core/html_canvas/html_canvas_renderable';
import {
    drawEllipse,
} from 'rendure/src/renderer/core/html_canvas/html_canvas_utils';


export type CFVElementClasses = 'block' | 'edge' | 'connector';

export abstract class CFVElement extends HTMLCanvasRenderable {

    protected _type: string = 'block';
    protected _label: string = '';
    protected _guid: string = '';

    public constructor(
        renderer: ControlFlowViewRenderer,
        ctx: CanvasRenderingContext2D,
        data?: Record<string, unknown>
    ) {
        super(renderer, ctx, -1, data);
    }

    public get renderer(): ControlFlowViewRenderer {
        return this._renderer as ControlFlowViewRenderer;
    }

    public drawSummaryInfo(
        _mousePos?: Point2D, _overrideTooFarForText?: boolean
    ): void {
        return;
    }

    public shade(_color: string, _alpha: number): void {
        return;
    }

    public minimapDraw(): void {
        this.draw();
    }

    public get type(): string {
        return this._type;
    }

    public get label(): string {
        return this._label;
    }

    public set label(label: string) {
        this._label = label;
    }

    public get guid(): string {
        return this._guid;
    }

}

export class CFVDependencyEdge extends CFVElement {

    public points: Point2D[] = [];

    public constructor(
        renderer: ControlFlowViewRenderer,
        ctx: CanvasRenderingContext2D,
        label: string,
        public readonly memlet: Record<string, unknown>,
        public readonly src: CFVControlFlowBlock,
        public readonly dst: CFVControlFlowBlock,
        public readonly includeSubset: boolean = false
    ) {
        super(renderer, ctx, memlet);
        this._label = label;
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

    protected _internalDraw(mousepos?: Point2D): void {
        this.ctx.beginPath();
        this.ctx.moveTo(this.points[0].x, this.points[0].y);
        for (let i = 1; i < this.points.length; i++)
            this.ctx.lineTo(this.points[i].x, this.points[i].y);
        this.ctx.fillStyle = this.ctx.strokeStyle = 'blue';
        this.ctx.setLineDash([1, 0]);
        this.ctx.stroke();

        this.drawArrow(
            this.ctx, this.points[this.points.length - 2],
            this.points[this.points.length - 1], 3
        );

        if (this.hovered && mousepos) {
            if (this.includeSubset) {
                const memletAttrs = (
                    this.memlet.attributes
                ) as Record<string, unknown> | undefined;
                const subsetString = sdfgPropertyToString(
                    memletAttrs?.subset, SDFVSettings.settingsDict
                );
                const tooltipText = this.label + ' ' + subsetString;
                this.renderer.showTooltip(mousepos.x, mousepos.y, tooltipText);
            } else {
                this.renderer.showTooltip(mousepos.x, mousepos.y, this.label);
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
                const linePoint0 = this.points[i];
                const linePoint1 = this.points[i + 1];
                // Rectangle spanned by the two line points
                const r = {
                    x: Math.min(linePoint0.x, linePoint1.x),
                    y: Math.min(linePoint0.y, linePoint1.y),
                    w: Math.abs(linePoint1.x - linePoint0.x),
                    h: Math.abs(linePoint1.y - linePoint0.y),
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

export class CFVConnector extends CFVElement {

    protected readonly color: string = 'black';

    public edges: CFVDependencyEdge[] = [];

    public constructor(
        renderer: ControlFlowViewRenderer,
        ctx: CanvasRenderingContext2D,
        public readonly dataName: string
    ) {
        super(renderer, ctx);

        this._label = dataName;
    }

    protected _internalDraw(_mousepos?: Point2D): void {
        this.ctx.beginPath();
        drawEllipse(this.ctx, this.x, this.y, this.width, this.height);
        this.ctx.closePath();
        this.ctx.fillStyle = this.color;
        this.ctx.fill();
    }

}

export class CFVControlFlowBlock extends CFVElement {

    protected readonly color: string = 'black';
    public inConnectors: CFVConnector[] = [];
    public outConnectors: CFVConnector[] = [];

    public constructor(
        renderer: ControlFlowViewRenderer,
        ctx: CanvasRenderingContext2D,
        data: Record<string, unknown>,
        public readonly parent?: CFVControlFlowBlock
    ) {
        super(renderer, ctx, data);
    }

    protected _internalDraw(mousepos?: Point2D): void {
        this.ctx.strokeStyle = this.color;
        this.ctx.strokeRect(this.x, this.y, this.width, this.height);

        for (const icon of this.inConnectors)
            icon.draw(mousepos);
        for (const ocon of this.outConnectors)
            ocon.draw(mousepos);

        if (this.selected) {
            this.ctx.fillStyle = this.color;
            const oldAlpha = this.ctx.globalAlpha;
            this.ctx.globalAlpha = 0.2;
            this.ctx.fillRect(this.x, this.y, this.width, this.height);
            this.ctx.globalAlpha = oldAlpha;

            for (const icon of this.inConnectors) {
                for (const edge of icon.edges)
                    edge.draw(mousepos);
            }
            for (const ocon of this.outConnectors) {
                for (const edge of ocon.edges)
                    edge.draw(mousepos);
            }
        }

        if (this.hovered) {
            this.ctx.fillStyle = this.color;
            const oldAlpha = this.ctx.globalAlpha;
            this.ctx.globalAlpha = 0.1;
            this.ctx.fillRect(this.x, this.y, this.width, this.height);
            this.ctx.globalAlpha = oldAlpha;
        }
    }

}

export class CFVBasicBlock extends CFVControlFlowBlock {

    protected readonly color: string = 'gray';

}

export class CFVSequence extends CFVControlFlowBlock {

    public COLLAPSIBLE: boolean = true;

    public readonly children: CFVControlFlowBlock[] = [];

    protected readonly color: string = 'gray';
    protected collapsed: boolean = false;

    private _isRoot: boolean = false;

    public constructor(
        renderer: ControlFlowViewRenderer, ctx: CanvasRenderingContext2D,
        data: Record<string, unknown>, parent?: CFVControlFlowBlock
    ) {
        super(renderer, ctx, data, parent);
        if (parent === undefined) {
            this.collapsed = false;
            this._isRoot = true;
        }
    }

    protected _internalDraw(mousepos?: Point2D): void {
        if (!this._isRoot)
            super.draw(mousepos);

        if (this.collapsed) {
            const plusCenterY = this.y + this.height / 2;
            const plusCenterX = this.x + this.width / 2;
            this.ctx.beginPath();
            this.ctx.moveTo(plusCenterX, plusCenterY - 20);
            this.ctx.lineTo(plusCenterX, plusCenterY + 20);
            this.ctx.moveTo(plusCenterX - 20, plusCenterY);
            this.ctx.lineTo(plusCenterX + 20, plusCenterY);
            this.ctx.stroke();
        } else {
            for (const child of this.children)
                child.draw(mousepos);
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

export class CFVLoop extends CFVSequence {

    protected readonly color: string = 'red';

    protected _internalDraw(mousepos?: Point2D): void {
        const color = this.data?.parallel ? 'green' : 'red';
        this.ctx.strokeStyle = color;
        this.ctx.strokeRect(this.x, this.y, this.width, this.height);

        for (const icon of this.inConnectors)
            icon.draw(mousepos);
        for (const ocon of this.outConnectors)
            ocon.draw(mousepos);

        if (this.selected) {
            this.ctx.fillStyle = color;
            const oldAlpha = this.ctx.globalAlpha;
            this.ctx.globalAlpha = 0.2;
            this.ctx.fillRect(this.x, this.y, this.width, this.height);
            this.ctx.globalAlpha = oldAlpha;

            for (const icon of this.inConnectors) {
                for (const edge of icon.edges)
                    edge.draw(mousepos);
            }
            for (const ocon of this.outConnectors) {
                for (const edge of ocon.edges)
                    edge.draw(mousepos);
            }
        }

        if (this.hovered) {
            this.ctx.fillStyle = color;
            const oldAlpha = this.ctx.globalAlpha;
            this.ctx.globalAlpha = 0.1;
            this.ctx.fillRect(this.x, this.y, this.width, this.height);
            this.ctx.globalAlpha = oldAlpha;
        }

        if (this.collapsed) {
            const plusCenterY = this.y + this.height / 2;
            const plusCenterX = this.x + this.width / 2;
            this.ctx.beginPath();
            this.ctx.moveTo(plusCenterX, plusCenterY - 20);
            this.ctx.lineTo(plusCenterX, plusCenterY + 20);
            this.ctx.moveTo(plusCenterX - 20, plusCenterY);
            this.ctx.lineTo(plusCenterX + 20, plusCenterY);
            this.ctx.stroke();
        } else {
            for (const child of this.children)
                child.draw(mousepos);
        }

        const rangesString = this.data?.ranges as string | undefined;
        if (rangesString !== undefined) {
            this.ctx.fillStyle = 'black';
            this.ctx.fillText(
                rangesString, this.x + this.width / 2, this.y + 10
            );
        }
    }

}

export class CFVConditional extends CFVControlFlowBlock {

    public readonly branches: [string, CFVSequence][] = [];
    protected readonly color: string = 'blue';

    protected collapsed: boolean = false;

    protected _internalDraw(mousepos?: Point2D): void {
        super.draw(mousepos);
        if (this.collapsed) {
            const plusCenterY = this.y + this.height / 2;
            const plusCenterX = this.x + this.width / 2;
            this.ctx.beginPath();
            this.ctx.moveTo(plusCenterX, plusCenterY - 20);
            this.ctx.lineTo(plusCenterX, plusCenterY + 20);
            this.ctx.moveTo(plusCenterX - 20, plusCenterY);
            this.ctx.lineTo(plusCenterX + 20, plusCenterY);
            this.ctx.stroke();
        } else {
            for (const branch of this.branches)
                branch[1].draw(mousepos);
        }
    }

    public toggleCollapse(): void {
        this.collapsed = !this.collapsed;
    }

    public get isCollapsed(): boolean {
        return this.collapsed;
    }

}

export class CFVParallel extends CFVControlFlowBlock {

    public readonly sections: CFVControlFlowBlock[][] = [];

}

export class CFVIrreducible extends CFVControlFlowBlock {
}
