// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import type { GraphEdge } from 'dagre';
import type { Edge } from '../renderer/sdfg/sdfg_elements';
import type { DagreGraph } from '../renderer/sdfg/sdfg_renderer';


/**
 * Calculate the bounding box for a dagre layout graph.
 * @param g Dagre graph to calculate the bounding box for.
 * @returns Bounding box of `g`.
 */
export function calculateBoundingBox(g: DagreGraph): {
    x: number, y: number, width: number, height: number
} {
    // iterate over all objects, calculate the size of the bounding box
    const bb = {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
    };

    g.nodes().forEach((v) => {
        const node = g.node(v);
        if (node) {
            const x = node.x + node.width / 2.0;
            const y = node.y + node.height / 2.0;
            if (x > bb.width)
                bb.width = x;
            if (y > bb.height)
                bb.height = y;
        }
    });
    g.edges().forEach((e) => {
        const edge = g.edge(e);
        if (edge) {
            const points = edge.points;
            points.forEach((p) => {
                if (p.x > bb.width)
                    bb.width = p.x;
                if (p.y > bb.height)
                    bb.height = p.y;
            });
        }
    });

    return bb;
}

/**
 * Calculate the bounding box around an edge.
 * @param edge Edge to calculate the bounding box for.
 * @returns    The bounding box around `edge`.
 */
export function calculateEdgeBoundingBox(edge: Edge | GraphEdge): {
    x: number, y: number, width: number, height: number
} {
    // iterate over all points, calculate the size of the bounding box
    const points = edge.points;
    const bb = {
        x1: points[0].x,
        y1: points[0].y,
        x2: points[0].x,
        y2: points[0].y,
    };

    points.forEach(p => {
        bb.x1 = p.x < bb.x1 ? p.x : bb.x1;
        bb.y1 = p.y < bb.y1 ? p.y : bb.y1;
        bb.x2 = p.x > bb.x2 ? p.x : bb.x2;
        bb.y2 = p.y > bb.y2 ? p.y : bb.y2;
    });

    const retBB = {
        x: bb.x1,
        y: bb.y1,
        width: bb.x2 - bb.x1,
        height: bb.y2 - bb.y1,
    };
    if (retBB.width <= 5) {
        retBB.width = 10;
        retBB.x -= 5;
    }
    if (retBB.height <= 5) {
        retBB.height = 10;
        retBB.y -= 5;
    }
    return retBB;
}

/**
 * Update the layout values of an edge with a recalculated edge bounding box.
 * This operates in-place on the edge.
 * @param edge The edge to recalculate the layout for.
 */
export function updateEdgeBoundingBox(edge: Edge | GraphEdge): void {
    const bb = calculateEdgeBoundingBox(edge);
    edge.x = (bb.x ? bb.x : 0) + bb.width / 2;
    edge.y = (bb.y ? bb.y : 0) + bb.height / 2;
    edge.width = bb.width;
    edge.height = bb.height;
}
