// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { Point2D } from '../types';
import { lerpMatrix } from '../rendering_core/html_canvas/lerp_matrix';
import { ControlFlowView } from './control_flow_view';

const animation_duration = 1000;

// cubic ease out
const animation_function = (t: number) => 1 - Math.pow(1 - t, 3);

let _canvas_manager_counter = 0;

/**
 * Manages translation and scaling of canvas rendering.
 */
export class CanvasManager {

    private anim_id: number | null = null;
    private prev_time: number | null = null;
    private drawables: any[] = [];
    private indices: any[] = [];

    private animation_start: number | null = null;
    private animation_end: number | null = null;
    private animation_target: DOMMatrix | null = null;

    // Takes a number [0, 1] and returns a transformation matrix.
    private animation: ((t: any) => DOMMatrix) | null = null;

    private request_scale: boolean = false;
    private scalef: number = 1.0;

    private _destroying: boolean = false;

    private scale_origin: Point2D = { x: 0, y: 0 };

    private contention: number = 0;

    private _svg: SVGSVGElement;
    private user_transform: DOMMatrix;

    public static counter(): number {
        return _canvas_manager_counter++;
    }

    public constructor(
        private ctx: CanvasRenderingContext2D,
        private renderer: ControlFlowView,
        private canvas: HTMLCanvasElement
    ) {
        this._svg = document.createElementNS(
            'http://www.w3.org/2000/svg', 'svg'
        );

        this.user_transform = this._svg.createSVGMatrix();

        this.addCtxTransformTracking();
    }

    public stopAnimation(): void {
        this.animation_start = null;
        this.animation_end = null;
        this.animation = null;
        this.animation_target = null;
    }

    public alreadyAnimatingTo(new_transform: DOMMatrix): boolean {
        if (this.animation_target) {
            let result = true;
            result = result && (this.animation_target.a === new_transform.a);
            result = result && (this.animation_target.b === new_transform.b);
            result = result && (this.animation_target.c === new_transform.c);
            result = result && (this.animation_target.d === new_transform.d);
            result = result && (this.animation_target.e === new_transform.e);
            result = result && (this.animation_target.f === new_transform.f);
            return result;
        } else {
            return false;
        }
    }

    public animateTo(new_transform: DOMMatrix): void {
        // If was already animating to the same target, jump to it directly
        if (this.alreadyAnimatingTo(new_transform)) {
            this.stopAnimation();
            this.user_transform = new_transform;
            return;
        }

        this.stopAnimation();
        this.animation = lerpMatrix(this.user_transform, new_transform);
        this.animation_target = new_transform;
    }

    public svgPoint(x: number, y: number): DOMPoint {
        const pt = this._svg.createSVGPoint();
        pt.x = x; pt.y = y;
        return pt;
    }

    public applyUserTransform(): void {
        const ut = this.user_transform;
        this.ctx.setTransform(ut.a, ut.b, ut.c, ut.d, ut.e, ut.f);
    }

    public get translation(): Point2D {
        return { x: this.user_transform.e, y: this.user_transform.f };
    }

    public addCtxTransformTracking(): void {
        /* This function is a hack to provide the non-standardized functionality
        of getting the current transform from a RenderingContext.
        When (if) this is standardized, the standard should be used instead.
        This is made for "easy" transforms and does not support saving/restoring
        */

        const svg = document.createElementNS(
            'http://www.w3.org/2000/svg', 'svg'
        );
        (this.ctx as any)._custom_transform_matrix = svg.createSVGMatrix();
        // Save/Restore is not supported.

        const checker = () => {
            console.assert(
                !isNaN((this.ctx as any)._custom_transform_matrix.f)
            );
        };
        const _ctx = this.ctx;
        const scale_func = _ctx.scale;
        _ctx.scale = function (sx, sy) {
            (_ctx as any)._custom_transform_matrix =
                (_ctx as any)._custom_transform_matrix.scaleNonUniform(sx, sy);
            checker();
            return scale_func.call(_ctx, sx, sy);
        };
        const translate_func = _ctx.translate;
        _ctx.translate = function (sx, sy) {
            (_ctx as any)._custom_transform_matrix =
                (_ctx as any)._custom_transform_matrix.translate(sx, sy);
            checker();
            return translate_func.call(_ctx, sx, sy);
        };
        const rotate_func = _ctx.rotate;
        _ctx.rotate = function (r) {
            (_ctx as any)._custom_transform_matrix =
                (_ctx as any)._custom_transform_matrix.rotate(
                    r * 180.0 / Math.PI
                );
            checker();
            return rotate_func.call(_ctx, r);
        };
        const transform_func = _ctx.scale;
        _ctx.transform = function (a, b, c, d, e, f) {
            const m2 = svg.createSVGMatrix();
            m2.a = a; m2.b = b; m2.c = c; m2.d = d; m2.e = e; m2.f = f;
            (_ctx as any)._custom_transform_matrix =
                (_ctx as any)._custom_transform_matrix.multiply(m2);
            checker();
            return (transform_func as any).call(_ctx, a, b, c, d, e, f);
        };

        const setTransform_func = _ctx.setTransform;
        (_ctx as any).setTransform = function (
            a: number, b: number, c: number, d: number, e: number, f: number
        ) {
            const ctxref: any = _ctx;
            ctxref._custom_transform_matrix.a = a;
            ctxref._custom_transform_matrix.b = b;
            ctxref._custom_transform_matrix.c = c;
            ctxref._custom_transform_matrix.d = d;
            ctxref._custom_transform_matrix.e = e;
            ctxref._custom_transform_matrix.f = f;
            checker();
            return (setTransform_func as any).call(_ctx, a, b, c, d, e, f);
        };

        (_ctx as any).custom_inverseTransformMultiply =
            function (x: number, y: number) {
                const pt = svg.createSVGPoint();
                pt.x = x; pt.y = y;
                checker();
                return pt.matrixTransform(
                    (_ctx as any)._custom_transform_matrix.inverse()
                );
            };
    }

    public destroy(): void {
        this._destroying = true;
        this.clearDrawables();
    }

    public addDrawable(obj: unknown): void {
        this.drawables.push(obj);
        this.indices.push({ 'c': CanvasManager.counter(), 'd': obj });
    }

    public removeDrawable(drawable: unknown): void {
        this.drawables = this.drawables.filter(x => x !== drawable);
    }

    public clearDrawables(): void {
        for (const x of this.drawables)
            x.destroy();
        this.drawables = [];
        this.indices = [];
    }

    // TODO: WARNING! This function uses ctx.getImageData() which forces
    // the browser to turn off GPU accelerated canvas painting!
    // It needs to be reworked to not use getImageData() anymore.
    public isBlank(): boolean {
        const ctx = this.canvas.getContext('2d');
        if (!ctx)
            return true;

        const topleft = ctx.getImageData(0, 0, 1, 1).data;
        if (topleft[0] !== 0 || topleft[1] !== 0 || topleft[2] !== 0 ||
            topleft[3] !== 255)
            return false;

        const pixelBuffer = new Uint32Array(
            ctx.getImageData(
                0, 0, this.canvas.width, this.canvas.height
            ).data.buffer
        );

        return !pixelBuffer.some(color => color !== 0xff000000);
    }

    public scale(diff: number, x: number = 0, y: number = 0): void {
        this.stopAnimation();
        if (this.request_scale || this.contention > 0)
            return;
        this.contention++;
        this.request_scale = true;

        // Don't use the easteregg feature as long as isBlank() is not fixed!
        // if (this.isBlank()) {
        //     this.renderer.set_bgcolor('black');
        //     this.renderer.zoom_to_view(null, false);
        //     diff = 0.01;
        // }

        this.scale_origin.x = x;
        this.scale_origin.y = y;

        const sv = diff;
        const pt = this.svgPoint(
            this.scale_origin.x, this.scale_origin.y
        ).matrixTransform(this.user_transform.inverse());
        this.user_transform = this.user_transform.translate(pt.x, pt.y);
        this.user_transform = this.user_transform.scale(sv, sv, 1, 0, 0, 0);
        this.scalef *= sv;
        this.user_transform = this.user_transform.translate(-pt.x, -pt.y);

        this.contention--;
    }

    // Sets the view to the square around the input rectangle
    public set_view(rect: DOMRect, animate: boolean = false): void {
        const canvas_w = this.canvas.width;
        const canvas_h = this.canvas.height;
        if (canvas_w === 0 || canvas_h === 0)
            return;

        let scale = 1, tx = 0, ty = 0;
        if (rect.width > rect.height) {
            scale = canvas_w / rect.width;
            tx = -rect.x;
            ty = -rect.y - (rect.height / 2) + (canvas_h / scale / 2);

            // Now other dimension does not fit, scale it as well
            if (rect.height * scale > canvas_h) {
                scale = canvas_h / rect.height;
                tx = -rect.x - (rect.width / 2) + (canvas_w / scale / 2);
                ty = -rect.y;
            }
        } else {
            scale = canvas_h / rect.height;
            tx = -rect.x - (rect.width / 2) + (canvas_w / scale / 2);
            ty = -rect.y;

            // Now other dimension does not fit, scale it as well
            if (rect.width * scale > canvas_w) {
                scale = canvas_w / rect.width;
                tx = -rect.x;
                ty = -rect.y - (rect.height / 2) + (canvas_h / scale / 2);
            }
        }

        // Uniform scaling
        const new_transform = this._svg.createSVGMatrix().scale(
            scale, scale, 1, 0, 0, 0
        ).translate(tx, ty);

        if (animate && this.prev_time !== null) {
            this.animateTo(new_transform);
        } else {
            this.stopAnimation();
            this.user_transform = new_transform;
        }

        this.scale_origin = { x: 0, y: 0 };
        this.scalef = 1.0;
    }

    public translate(x: number, y: number): void {
        this.stopAnimation();
        this.user_transform = this.user_transform.translate(
            x / this.user_transform.a, y / this.user_transform.d
        );
    }

    public mapPixelToCoordsX(xpos: number): number {
        return this.svgPoint(xpos, 0).matrixTransform(
            this.user_transform.inverse()
        ).x;
    }

    public mapPixelToCoordsY(ypos: number): number {
        return this.svgPoint(0, ypos).matrixTransform(
            this.user_transform.inverse()
        ).y;
    }

    public noJitter(x: number): number {
        x = parseFloat(x.toFixed(3));
        x = Math.round(x * 100) / 100;
        return x;
    }

    public points_per_pixel(): number {
        // Since we are using uniform scaling, (bottom-top)/height and
        // (right-left)/width should be equivalent
        const left = this.mapPixelToCoordsX(0);
        const right = this.mapPixelToCoordsX(this.canvas.width);
        return (right - left) / this.canvas.width;
    }

    public animation_step(now: number): void {
        if (this.animation === null)
            return;

        if (this.animation_start === null) {
            this.animation_start = now;
            this.animation_end = now + animation_duration;
        }

        if (this.animation_end === null || now >= this.animation_end) {
            this.user_transform = this.animation(1);
            this.stopAnimation();
            return;
        }

        const start = this.animation_start;
        const end = this.animation_end;
        this.user_transform = this.animation(
            animation_function((now - start) / (end - start))
        );
    }

    public draw_now(now: number): void {
        if (this._destroying)
            return;

        let dt: number | null = null;
        if (!this.prev_time)
            dt = null;
        else
            dt = now - this.prev_time;
        this.prev_time = now;

        if (this.contention > 0)
            return;
        this.contention += 1;
        const ctx = this.ctx;

        // Clear with default transform
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.fillStyle = this.renderer.backgroundColor;
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

        this.animation_step(now);

        this.applyUserTransform();
        if (this.request_scale)
            this.request_scale = this.contention !== 1;

        this.renderer.draw(dt);
        this.contention -= 1;

        if (this.animation_end !== null && now < this.animation_end)
            this.draw_async();
    }

    public draw_async(): void {
        this.anim_id = window.requestAnimationFrame(
            (now) => this.draw_now(now)
        );
    }

    public get_user_transform(): DOMMatrix {
        return this.user_transform;
    }

    public set_user_transform(user_transform: DOMMatrix): void {
        this.user_transform = user_transform;
    }

}
