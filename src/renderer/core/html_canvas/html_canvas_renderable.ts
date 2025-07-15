// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { Renderable } from '../common/renderable';
import { HTMLCanvasRenderer } from './html_canvas_renderer';


export abstract class HTMLCanvasRenderable extends Renderable {

    protected _activeCtx: CanvasRenderingContext2D;
    protected _minimapCtx?: CanvasRenderingContext2D;

    public constructor(
        renderer: HTMLCanvasRenderer,
        protected readonly _ctx: CanvasRenderingContext2D,
        id: number,
        data?: Record<string, unknown>
    ) {
        super(renderer, id, data);
        this._activeCtx = _ctx;
    }

    protected get minimapCxt(): CanvasRenderingContext2D | undefined {
        return this._minimapCtx;
    }

    protected set minimapCxt(ctx: CanvasRenderingContext2D | undefined) {
        this._minimapCtx = ctx;
    }

    protected get ctx(): CanvasRenderingContext2D {
        return this._activeCtx;
    }

    public setTemporaryContext(ctx: CanvasRenderingContext2D): void {
        this._activeCtx = ctx;
    }

    public restoreContext(): void {
        this._activeCtx = this._ctx;
    }

    public debugDraw(overrideDebugDrawEnabled: boolean = false): void {
        if (this.renderer.debugDraw || overrideDebugDrawEnabled) {
            // Print the center and bounding box in debug mode.
            this.ctx.beginPath();
            this.ctx.arc(this.x, this.y, 1, 0, 2 * Math.PI, false);
            this.ctx.fillStyle = 'red';
            this.ctx.fill();
            this.ctx.strokeStyle = 'red';
            this.ctx.stroke();
            this.ctx.strokeRect(
                this.x - (this.width / 2.0), this.y - (this.height / 2.0),
                this.width, this.height
            );
        }
    }

}
