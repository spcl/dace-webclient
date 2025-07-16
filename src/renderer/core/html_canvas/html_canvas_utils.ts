// Copyright (c) Philipp Schaad and rendure authors. All rights reserved.

import {
    DEFAULT_CANVAS_FONTSIZE,
    DEFAULT_FAR_FONT_MULTIPLIER,
    DEFAULT_MAX_FONTSIZE,
} from '../../../constants';
import type { Point2D } from '../../../types';
import type { HTMLCanvasRenderer } from './html_canvas_renderer';

interface DOMMatrixDecomposition {
    translate: [number, number];
    scale: [number, number];
    skew11: number;
    skew12: number;
    skew21: number;
    skew22: number;
    angle: number;
}

/**
 * Returns a function taking a number from 0 to 1 which linearly interpolates
 * between two matrices. Uses the matrix interpolation algorithm for CSS
 * animations:
 * https://www.w3.org/TR/css-transforms-1/#decomposing-a-2d-matrix
 */
export function lerpMatrix(
    m1: DOMMatrix, m2: DOMMatrix
): (t: number) => DOMMatrix {
    function decompose(m: DOMMatrix): DOMMatrixDecomposition {
        const scale: [number, number] = [
            Math.sqrt(m.a * m.a + m.b * m.b),
            Math.sqrt(m.c * m.c + m.d * m.d),
        ];

        const det = m.a * m.d - m.b * m.c;
        if (det < 0) {
            if (m.a < m.d)
                scale[0] = -scale[0];
            else
                scale[1] = -scale[1];
        }

        const row0x = m.a / (scale[0] || 1);
        const row0y = m.b / (scale[0] || 1);
        const row1x = m.c / (scale[1] || 1);
        const row1y = m.d / (scale[1] || 1);

        const skew11 = row0x * row0x - row0y * row1x;
        const skew12 = row0x * row0y - row0y * row1y;
        const skew21 = row0x * row1x - row0y * row0x;
        const skew22 = row0x * row1y - row0y * row0y;

        const angle = Math.atan2(m.b, m.a) * 180 / Math.PI;

        return {
            translate: [m.e, m.f],
            scale,
            skew11,
            skew12,
            skew21,
            skew22,
            angle,
        };
    }

    function lerpDecomposed(
        d1: DOMMatrixDecomposition, d2: DOMMatrixDecomposition, t: number
    ): DOMMatrixDecomposition {
        function lerp(a: number, b: number): number {
            return (b - a) * t + a;
        }

        let d1Angle = d1.angle || 360;
        let d2Angle = d2.angle || 360;
        let d1Scale = d1.scale;

        if ((d1.scale[0] < 0 && d2.scale[1] < 0) ||
            (d1.scale[1] < 0 && d2.scale[0] < 0)) {
            d1Scale = [-d1Scale[0], -d1Scale[1]];
            d1Angle += d1Angle < 0 ? 180 : -180;
        }

        if (Math.abs(d1Angle - d2Angle) > 180) {
            if (d1Angle > d2Angle)
                d1Angle -= 360;
            else
                d2Angle -= 360;
        }


        return {
            translate: [
                lerp(d1.translate[0], d2.translate[0]),
                lerp(d1.translate[1], d2.translate[1]),
            ],
            scale: [
                lerp(d1Scale[0], d2.scale[0]),
                lerp(d1Scale[1], d2.scale[1]),
            ],
            skew11: lerp(d1.skew11, d2.skew11),
            skew12: lerp(d1.skew12, d2.skew12),
            skew21: lerp(d1.skew21, d2.skew21),
            skew22: lerp(d1.skew22, d2.skew22),
            angle: lerp(d1Angle, d2Angle),
        };
    }

    function recompose(d: DOMMatrixDecomposition): DOMMatrix {
        const matrix = document.createElementNS(
            'http://www.w3.org/2000/svg', 'svg'
        ).createSVGMatrix();
        matrix.a = d.skew11;
        matrix.b = d.skew12;
        matrix.c = d.skew21;
        matrix.d = d.skew22;
        matrix.e = d.translate[0] * d.skew11 + d.translate[1] * d.skew21;
        matrix.f = d.translate[0] * d.skew12 + d.translate[1] * d.skew22;
        return matrix.rotate(0, 0, d.angle * Math.PI / 180).scale(
            d.scale[0], d.scale[1]
        );
    }

    const d1 = decompose(m1);
    const d2 = decompose(m2);

    return (t: number) => recompose(lerpDecomposed(d1, d2, t));
}

export enum TextVAlign {
    TOP,
    MIDDLE,
    BOTTOM,
}

export enum TextHAlign {
    LEFT,
    CENTER,
    RIGHT,
}

interface AdaptiveTextPadding {
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
}

export function drawAdaptiveText(
    ctx: CanvasRenderingContext2D, renderer: HTMLCanvasRenderer,
    farText: string, closeText: string,
    x: number, y: number, w: number, h: number,
    pppThresh: number, maxFontSize: number = DEFAULT_MAX_FONTSIZE,
    closeFontMultiplier: number = 1.0,
    farFontMultiplier: number = DEFAULT_FAR_FONT_MULTIPLIER,
    bold: boolean = false,
    valign: TextVAlign = TextVAlign.MIDDLE,
    halign: TextHAlign = TextHAlign.CENTER,
    padding: AdaptiveTextPadding = {}
): void {
    // Save font.
    const oldFont = ctx.font;

    const ppp = renderer.canvasManager.pointsPerPixel;

    const isFar: boolean = renderer.adaptiveHiding && ppp > pppThresh;
    const label = isFar ? farText : closeText;

    let fontSize = Math.min(
        DEFAULT_CANVAS_FONTSIZE * closeFontMultiplier, maxFontSize
    );
    if (isFar)
        fontSize = Math.min(ppp * farFontMultiplier, maxFontSize);
    ctx.font = fontSize.toString() + 'px sans-serif';

    const labelMetrics = ctx.measureText(label);

    let labelWidth = Math.abs(labelMetrics.actualBoundingBoxLeft) +
        Math.abs(labelMetrics.actualBoundingBoxRight);
    let labelHeight = Math.abs(labelMetrics.actualBoundingBoxDescent) +
        Math.abs(labelMetrics.actualBoundingBoxAscent);
    if (labelWidth !== labelWidth)
        labelWidth = labelMetrics.width;

    // Account for canvas2pdf
    if ('pdf' in ctx && ctx.pdf && labelHeight !== (
            labelMetrics as unknown as Record<string, number>
    ).height) {
        labelHeight = (
            labelMetrics as unknown as Record<string, number>
        ).height;
    }

    const paddingLeft = padding.left ?? 1.0;
    const paddingTop = padding.top ?? 0.0;
    const paddingRight = padding.right ?? 1.0;
    const paddingBottom = padding.bottom ?? 4.0;

    // Ensure text is not resized beyond the bounds of the box
    if (isFar && labelWidth > w) {
        const oldFontSize = fontSize;
        fontSize = fontSize / (labelWidth / w);
        labelWidth /= (labelWidth / w);
        labelHeight /= (oldFontSize / fontSize);
        ctx.font = fontSize.toString() + 'px sans-serif';
    }

    let textCenterX;
    let textCenterY;
    switch (valign) {
        case TextVAlign.TOP:
            textCenterY = y - (h / 2.0) + (labelHeight + paddingTop);
            break;
        case TextVAlign.BOTTOM:
            textCenterY = y + (h / 2.0) - paddingBottom;
            break;
        case TextVAlign.MIDDLE:
        default:
            textCenterY = y + (labelHeight / 2.0);
            break;
    }
    switch (halign) {
        case TextHAlign.LEFT:
            textCenterX = (x - (w / 2.0)) + paddingLeft;
            break;
        case TextHAlign.RIGHT:
            textCenterX = (x + (w / 2.0)) - (labelWidth + paddingRight);
            break;
        case TextHAlign.CENTER:
        default:
            textCenterX = x - (labelWidth / 2.0);
            break;
    }

    if (bold)
        ctx.font = 'bold ' + ctx.font;

    ctx.fillText(label, textCenterX, textCenterY);

    // Restore previous font.
    ctx.font = oldFont;
}

export function drawHexagon(
    ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
    _offset: Point2D
): void {
    const topleft = { x: x - w / 2.0, y: y - h / 2.0 };
    const hexseg = h / 3.0;
    ctx.beginPath();
    ctx.moveTo(topleft.x, y);
    ctx.lineTo(topleft.x + hexseg, topleft.y);
    ctx.lineTo(topleft.x + w - hexseg, topleft.y);
    ctx.lineTo(topleft.x + w, y);
    ctx.lineTo(topleft.x + w - hexseg, topleft.y + h);
    ctx.lineTo(topleft.x + hexseg, topleft.y + h);
    ctx.lineTo(topleft.x, y);
    ctx.closePath();
}

export function drawOctagon(
    ctx: CanvasRenderingContext2D, x: number, y: number, width: number,
    height: number
): void {
    const octseg = height / 3.0;
    ctx.beginPath();
    ctx.moveTo(x, y + octseg);
    ctx.lineTo(x + octseg, y);
    ctx.lineTo(x + width - octseg, y);
    ctx.lineTo(x + width, y + octseg);
    ctx.lineTo(x + width, y + 2 * octseg);
    ctx.lineTo(x + width - octseg, y + height);
    ctx.lineTo(x + octseg, y + height);
    ctx.lineTo(x, y + 2 * octseg);
    ctx.lineTo(x, y + 1 * octseg);
    ctx.closePath();
}

export function drawEllipse(
    ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number
): void {
    ctx.beginPath();
    if ('pdf' in ctx && ctx.pdf) {
        // The PDF rendering context does not have an `ellipse` function. As
        // such, we revert back to the non-GPU-accelerated method of drawing
        // ellipses that we used up to and including commit 2ceba1d.
        // Adapted from https://stackoverflow.com/a/2173084/6489142
        const kappa = .5522848;
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
    ctx.closePath();
}

export function drawTrapezoid(
    ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
    inverted: boolean = false
): void {
    ctx.beginPath();
    if (inverted) {
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y);
        ctx.lineTo(x + w - h, y + h);
        ctx.lineTo(x + h, y + h);
        ctx.lineTo(x, y);
    } else {
        ctx.moveTo(x, y + h);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x + w - h, y);
        ctx.lineTo(x + h, y);
        ctx.lineTo(x, y + h);
    }
    ctx.closePath();
}
