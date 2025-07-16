// Copyright (c) Philipp Schaad and rendure authors. All rights reserved.

import type { Point2D, SimpleRect } from '../../../types';
import type { HTMLCanvasRenderer } from './html_canvas_renderer';
import { lerpMatrix } from './html_canvas_utils';

const ANIMATION_DURATION = 1000;

// Cubic ease out.
const animationFunction = (t: number) => 1 - Math.pow(1 - t, 3);

let _canvasManagerCounter = 0;

interface CustomCanvasRenderingContext2D extends CanvasRenderingContext2D {
    doc?: { page: { width: number, height: number }};
    _customTransformMatrix: DOMMatrix;
    customInverseTransformMultiply: (x: number, y: number) => DOMPoint;
}

interface ISetTransformFun {
    (m?: DOMMatrix2DInit): void;
    (a: number, b: number, c: number, d: number, e: number, f: number): void;
};

/**
 * Manages translation and scaling of canvas rendering.
 */
export class CanvasManager {

    private readonly ctx: CustomCanvasRenderingContext2D;
    private readonly renderer: HTMLCanvasRenderer;
    private readonly canvas: HTMLCanvasElement;

    private animationId: number | null = null;
    private prevTime: number | null = null;

    private animationStart: number | null = null;
    private animationEnd: number | null = null;
    private animationTarget: DOMMatrix | null = null;

    // Takes a number [0, 1] and returns a transformation matrix.
    private animation: ((t: any) => DOMMatrix) | null = null;

    private requestScale: boolean = false;
    private scalef: number = 1.0;

    private _destroying: boolean = false;

    private scaleOrigin: Point2D = { x: 0, y: 0 };

    private contention: number = 0;

    private _svg: SVGSVGElement;
    private userTransform: DOMMatrix;

    private _viewport: SimpleRect = {
        x: 0,
        y: 0,
        w: 0,
        h: 0,
    };

    public static counter(): number {
        return _canvasManagerCounter++;
    }

    public constructor(
        ctx: CanvasRenderingContext2D,
        renderer: HTMLCanvasRenderer,
        canvas: HTMLCanvasElement
    ) {
        this.ctx = ctx as CustomCanvasRenderingContext2D;
        this.renderer = renderer;
        this.canvas = canvas;

        this._svg = document.createElementNS(
            'http://www.w3.org/2000/svg', 'svg'
        );

        this.userTransform = this._svg.createSVGMatrix();

        this.addCtxTransformTracking();
    }

    public get viewport(): SimpleRect {
        return this._viewport;
    }

    public stopAnimation(): void {
        this.animationStart = null;
        this.animationEnd = null;
        this.animation = null;
        this.animationTarget = null;
    }

    public alreadyAnimatingTo(newTransform: DOMMatrix): boolean {
        if (this.animationTarget) {
            let result = this.animationTarget.a === newTransform.a;
            result = result && (this.animationTarget.b === newTransform.b);
            result = result && (this.animationTarget.c === newTransform.c);
            result = result && (this.animationTarget.d === newTransform.d);
            result = result && (this.animationTarget.e === newTransform.e);
            result = result && (this.animationTarget.f === newTransform.f);
            return result;
        } else {
            return false;
        }
    }

    public animateTo(newTransform: DOMMatrix): void {
        // If was already animating to the same target, jump to it directly
        if (this.alreadyAnimatingTo(newTransform)) {
            this.stopAnimation();
            this.userTransform = newTransform;
            return;
        }

        this.stopAnimation();
        this.animation = lerpMatrix(this.userTransform, newTransform);
        this.animationTarget = newTransform;
    }

    public svgPoint(x: number, y: number): DOMPoint {
        const pt = this._svg.createSVGPoint();
        pt.x = x; pt.y = y;
        return pt;
    }

    public applyUserTransform(): void {
        const ut = this.userTransform;
        this.ctx.setTransform(ut.a, ut.b, ut.c, ut.d, ut.e, ut.f);
    }

    public get translation(): Point2D {
        return { x: this.userTransform.e, y: this.userTransform.f };
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
        this.ctx._customTransformMatrix = svg.createSVGMatrix();
        // Save/Restore is not supported.

        const checker = () => {
            console.assert(
                !isNaN(this.ctx._customTransformMatrix.f)
            );
        };
        const _ctx = this.ctx;
        const scaleFunc = _ctx.scale.bind(_ctx);
        _ctx.scale = function (sx, sy) {
            _ctx._customTransformMatrix = _ctx._customTransformMatrix.scale(
                sx, sy
            );
            checker();
            scaleFunc(sx, sy);
        };
        const translateFunc = _ctx.translate.bind(_ctx);
        _ctx.translate = function (sx, sy) {
            _ctx._customTransformMatrix = _ctx._customTransformMatrix.translate(
                sx, sy
            );
            checker();
            translateFunc(sx, sy);
        };
        const rotateFunc = _ctx.rotate.bind(_ctx);
        _ctx.rotate = function (r) {
            _ctx._customTransformMatrix = _ctx._customTransformMatrix.rotate(
                r * 180.0 / Math.PI
            );
            checker();
            rotateFunc(r);
        };
        const transformFunc = _ctx.transform.bind(_ctx);
        _ctx.transform = function (a, b, c, d, e, f) {
            const m2 = svg.createSVGMatrix();
            m2.a = a;
            m2.b = b;
            m2.c = c;
            m2.d = d;
            m2.e = e;
            m2.f = f;
            _ctx._customTransformMatrix = _ctx._customTransformMatrix.multiply(
                m2
            );
            checker();
            transformFunc(a, b, c, d, e, f);
        };

        const setTransformFunc = _ctx.setTransform.bind(_ctx);
        _ctx.setTransform = function (
            a: number, b: number, c: number, d: number, e: number, f: number
        ) {
            const ctxref: CustomCanvasRenderingContext2D = _ctx;
            ctxref._customTransformMatrix.a = a;
            ctxref._customTransformMatrix.b = b;
            ctxref._customTransformMatrix.c = c;
            ctxref._customTransformMatrix.d = d;
            ctxref._customTransformMatrix.e = e;
            ctxref._customTransformMatrix.f = f;
            checker();
            setTransformFunc(a, b, c, d, e, f);
        } as ISetTransformFun;

        _ctx.customInverseTransformMultiply =
            function (x: number, y: number) {
                const pt = svg.createSVGPoint();
                pt.x = x; pt.y = y;
                checker();
                return pt.matrixTransform(
                    _ctx._customTransformMatrix.inverse()
                );
            };
    }

    public destroy(): void {
        this._destroying = true;
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
        if (this.requestScale || this.contention > 0)
            return;
        this.contention++;
        this.requestScale = true;

        // Don't use the easteregg feature as long as isBlank() is not fixed!
        // if (this.isBlank()) {
        //     this.renderer.set_bgcolor('black');
        //     this.renderer.zoom_to_view(null, false);
        //     diff = 0.01;
        // }

        this.scaleOrigin.x = x;
        this.scaleOrigin.y = y;

        const sv = diff;
        const pt = this.svgPoint(
            this.scaleOrigin.x, this.scaleOrigin.y
        ).matrixTransform(this.userTransform.inverse());
        this.userTransform = this.userTransform.translate(pt.x, pt.y);
        this.userTransform = this.userTransform.scale(sv, sv, 1, 0, 0, 0);
        this.scalef *= sv;
        this.userTransform = this.userTransform.translate(-pt.x, -pt.y);

        this.contention--;
    }

    // Sets the view to the square around the input rectangle
    public setView(rect: SimpleRect, animate: boolean = false): void {
        const canvasW = this.canvas.width;
        const canvasH = this.canvas.height;
        if (canvasW === 0 || canvasH === 0)
            return;

        let scale = 1, tx = 0, ty = 0;
        if (rect.w > rect.h) {
            scale = canvasW / rect.w;
            tx = -rect.x;
            ty = -rect.y - (rect.h / 2) + (canvasH / scale / 2);

            // Now other dimension does not fit, scale it as well
            if (rect.h * scale > canvasH) {
                scale = canvasH / rect.h;
                tx = -rect.x - (rect.w / 2) + (canvasW / scale / 2);
                ty = -rect.y;
            }
        } else {
            scale = canvasH / rect.h;
            tx = -rect.x - (rect.w / 2) + (canvasW / scale / 2);
            ty = -rect.y;

            // Now other dimension does not fit, scale it as well
            if (rect.w * scale > canvasW) {
                scale = canvasW / rect.w;
                tx = -rect.x;
                ty = -rect.y - (rect.h / 2) + (canvasH / scale / 2);
            }
        }

        // Uniform scaling
        const newTransform = this._svg.createSVGMatrix().scale(
            scale, scale, 1, 0, 0, 0
        ).translate(tx, ty);

        if (animate && this.prevTime !== null) {
            this.animateTo(newTransform);
        } else {
            this.stopAnimation();
            this.userTransform = newTransform;
        }

        this.scaleOrigin = { x: 0, y: 0 };
        this.scalef = 1.0;
    }

    public translate(x: number, y: number): void {
        this.stopAnimation();
        this.userTransform = this.userTransform.translate(
            x / this.userTransform.a, y / this.userTransform.d
        );
    }

    public mapPixelToCoordsX(xpos: number): number {
        return this.svgPoint(xpos, 0).matrixTransform(
            this.userTransform.inverse()
        ).x;
    }

    public mapPixelToCoordsY(ypos: number): number {
        return this.svgPoint(0, ypos).matrixTransform(
            this.userTransform.inverse()
        ).y;
    }

    public noJitter(x: number): number {
        x = parseFloat(x.toFixed(3));
        x = Math.round(x * 100) / 100;
        return x;
    }

    public get pointsPerPixel(): number {
        // Since we are using uniform scaling, (bottom-top)/height and
        // (right-left)/width should be equivalent
        const left = this.mapPixelToCoordsX(0);
        const right = this.mapPixelToCoordsX(this.canvas.width);
        return (right - left) / this.canvas.width;
    }

    public animationStep(now: number): void {
        if (this.animation === null)
            return;

        if (this.animationStart === null) {
            this.animationStart = now;
            this.animationEnd = now + ANIMATION_DURATION;
        }

        if (this.animationEnd === null || now >= this.animationEnd) {
            this.userTransform = this.animation(1);
            this.stopAnimation();
            return;
        }

        const start = this.animationStart;
        const end = this.animationEnd;
        this.userTransform = this.animation(
            animationFunction((now - start) / (end - start))
        );
    }

    public drawNow(now: number, ctx?: CustomCanvasRenderingContext2D): void {
        if (this._destroying)
            return;

        let dt: number | undefined = undefined;
        if (!this.prevTime)
            dt = undefined;
        else
            dt = now - this.prevTime;
        this.prevTime = now;

        if (this.contention > 0)
            return;
        this.contention += 1;
        const lCtx = ctx ?? this.ctx;

        // Clear with default transform
        const ctxWidth =
            lCtx.doc ? lCtx.doc.page.width : lCtx.canvas.width;
        const ctxHeight =
            lCtx.doc ? lCtx.doc.page.height : lCtx.canvas.height;
        lCtx.setTransform(1, 0, 0, 1, 0, 0);
        lCtx.clearRect(0, 0, ctxWidth, ctxHeight);
        lCtx.fillStyle = this.renderer.getBackgroundColor();
        lCtx.fillRect(0, 0, ctxWidth, ctxHeight);

        this.animationStep(now);

        this.applyUserTransform();
        if (this.requestScale)
            this.requestScale = this.contention !== 1;

        this.updateViewport();

        this.renderer.draw(dt, lCtx);
        this.contention -= 1;

        if (this.animationEnd !== null && now < this.animationEnd)
            this.drawAsync();
    }

    public drawAsync(ctx?: CanvasRenderingContext2D): void {
        this.animationId = window.requestAnimationFrame(
            (now) => {
                this.drawNow(now, ctx as CustomCanvasRenderingContext2D);
            }
        );
    }

    public updateViewport(): SimpleRect {
        const viewX = this.mapPixelToCoordsX(0);
        const viewY = this.mapPixelToCoordsY(0);
        const canvasw = this.canvas.width;
        const canvash = this.canvas.height;
        let endx = null;
        if (canvasw)
            endx = this.mapPixelToCoordsX(canvasw);
        let endy = null;
        if (canvash)
            endy = this.mapPixelToCoordsY(canvash);
        const viewWidth = (endx ?? 0) - (viewX ? viewX : 0);
        const viewHeight = (endy ?? 0) - (viewY ? viewY : 0);

        this._viewport = {
            x: viewX ? viewX : 0,
            y: viewY ? viewY : 0,
            w: viewWidth,
            h: viewHeight,
        };

        return this._viewport;
    }

    public getUserTransform(): DOMMatrix {
        return this.userTransform;
    }

    public setUserTransform(userTransform: DOMMatrix): void {
        this.userTransform = userTransform;
    }

}
