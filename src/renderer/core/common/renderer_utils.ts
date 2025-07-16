// Copyright (c) Philipp Schaad and rendure authors. All rights reserved.

import type { Point2D, SimpleRect } from '../../../types';
import { Renderable } from './renderable';


// Returns the distance from point p to line defined by two points
// (line1, line2)
export function ptLineDistance(
    p: Point2D, line1: Point2D, line2: Point2D
): number {
    const dx = (line2.x - line1.x);
    const dy = (line2.y - line1.y);
    const res = dy * p.x - dx * p.y + line2.x * line1.y - line2.y * line1.x;

    return Math.abs(res) / Math.sqrt(dy * dy + dx * dx);
}

/**
 * Calculate the bounding box for a list of Renderables.
 * @param elements Renderables to calculate bounding box for.
 * @param padding  Padding to add to the bounding box, in pixels.
 * @returns        Bounding box containing all renderables in `elements`.
 */
export function boundingBox(
    elements: Renderable[], padding: number = 0
): SimpleRect {
    const bb: {
        x1: number | null,
        x2: number | null,
        y1: number | null,
        y2: number | null,
    } = {
        x1: null,
        y1: null,
        x2: null,
        y2: null,
    };

    elements.forEach((v: Renderable) => {
        const topleft = v.topleft();
        if (bb.x1 === null || topleft.x < bb.x1)
            bb.x1 = topleft.x;
        if (bb.y1 === null || topleft.y < bb.y1)
            bb.y1 = topleft.y;

        const x2 = v.x + v.width / 2.0;
        const y2 = v.y + v.height / 2.0;

        if (bb.x2 === null || x2 > bb.x2)
            bb.x2 = x2;
        if (bb.y2 === null || y2 > bb.y2)
            bb.y2 = y2;
    });

    const retBB = {
        x: (bb.x1 ?? 0) - padding,
        y: (bb.y1 ?? 0) - padding,
        w: ((bb.x2 ?? 0) - (bb.x1 ?? 0)) + 2 * padding,
        h: ((bb.y2 ?? 0) - (bb.y1 ?? 0)) + 2 * padding,
    };

    return retBB;
}
