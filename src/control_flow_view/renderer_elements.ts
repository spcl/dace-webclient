// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { Point2D } from '../types';
import {
    _JsonCFBasicBlock,
    _JsonCFBlock,
    _JsonCFLoop,
    ControlFlowView,
} from './control_flow_view';


export type CFV_ElementClasses = 'block' | 'edge';

export class CFV_Element {

    // Indicate special drawing conditions based on interactions.
    public selected: boolean = false;
    public highlighted: boolean = false;
    public hovered: boolean = false;

    public x: number = 0;
    public y: number = 0;
    public width: number = 0;
    public height: number = 0;

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

}

export class CFV_ControlFlowBlock extends CFV_Element {

    protected readonly color: string = 'black';

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
    }

}

export class CFV_BasicBlock extends CFV_ControlFlowBlock {

    protected readonly color: string = 'gray';

}

export class CFV_Sequence extends CFV_ControlFlowBlock {

    public readonly children: CFV_ControlFlowBlock[] = [];

    public draw(
        renderer: ControlFlowView, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, realMousepos?: Point2D
    ): void {
        for (const child of this.children)
            child.draw(renderer, ctx, mousepos);
    }

}

export class CFV_Loop extends CFV_Sequence {

    protected readonly color: string = 'red';

    public draw(
        renderer: ControlFlowView, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, realMousepos?: Point2D
    ): void {
        ctx.strokeStyle = this.color;
        ctx.strokeRect(this.x, this.y, this.width, this.height);
        for (const child of this.children)
            child.draw(renderer, ctx, mousepos);
    }

}

export class CFV_Conditional extends CFV_ControlFlowBlock {

    public readonly branches: [string, CFV_Sequence][] = [];
    protected readonly color: string = 'blue';

    public draw(
        renderer: ControlFlowView, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, realMousepos?: Point2D
    ): void {
        super.draw(renderer, ctx, mousepos, realMousepos);
        for (const branch of this.branches)
            branch[1].draw(renderer, ctx, mousepos);
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
