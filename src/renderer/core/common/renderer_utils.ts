// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { Point2D } from '../../../types';

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
