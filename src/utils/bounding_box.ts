// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import { GraphEdge } from 'dagre';
import { Edge, SDFGElement } from '../renderer/renderer_elements';
import { DagreGraph } from '../index';

export function calculateBoundingBox(g: DagreGraph): DOMRect {
    // iterate over all objects, calculate the size of the bounding box
    const bb = new DOMRect();
    bb.x = 0;
    bb.x = 0;
    bb.width = 0;
    bb.height = 0;

    g.nodes().forEach((v) => {
        const x = g.node(v).x + g.node(v).width / 2.0;
        const y = g.node(v).y + g.node(v).height / 2.0;
        if (x > bb.width)
            bb.width = x;
        if (y > bb.height)
            bb.height = y;
    });
    g.edges().forEach((e) => {
        const points = g.edge(e).points;
        points.forEach((p) => {
            if (p.x > bb.width)
                bb.width = p.x;
            if (p.y > bb.height)
                bb.height = p.y;
        });
    });

    return bb;
}

export function boundingBox(
    elements: SDFGElement[], padding: number = 0
): DOMRect {
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

    elements.forEach((v: SDFGElement) => {
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

    const ret_bb = new DOMRect(
        (bb.x1 ? bb.x1 : 0) - padding,
        (bb.y1 ? bb.y1 : 0) - padding,
        ((bb.x2 ? bb.x2 : 0) - (bb.x1 ? bb.x1 : 0)) + 2 * padding,
        ((bb.y2 ? bb.y2 : 0) - (bb.y1 ? bb.y1 : 0)) + 2 * padding
    );

    return ret_bb;
}

export function calculateEdgeBoundingBox(edge: Edge | GraphEdge): DOMRect {
    // iterate over all points, calculate the size of the bounding box
    const points = edge.get_points();
    const bb = {
        x1: points[0].x,
        y1: points[0].y,
        x2: points[0].x,
        y2: points[0].y,
    };

    points.forEach((p: any) => {
        bb.x1 = p.x < bb.x1 ? p.x : bb.x1;
        bb.y1 = p.y < bb.y1 ? p.y : bb.y1;
        bb.x2 = p.x > bb.x2 ? p.x : bb.x2;
        bb.y2 = p.y > bb.y2 ? p.y : bb.y2;
    });

    const ret_bb = new DOMRect(bb.x1, bb.y1, bb.x2 - bb.x1, bb.y2 - bb.y1);
    if (ret_bb.width <= 5) {
        ret_bb.width = 10;
        ret_bb.x -= 5;
    }
    if (ret_bb.height <= 5) {
        ret_bb.height = 10;
        ret_bb.y -= 5;
    }
    return ret_bb;
}

export function updateEdgeBoundingBox(edge: Edge | GraphEdge): void {
    const bb = calculateEdgeBoundingBox(edge);
    edge.x = (bb.x ? bb.x : 0) + bb.width / 2;
    edge.y = (bb.y ? bb.y : 0) + bb.height / 2;
    edge.width = bb.width;
    edge.height = bb.height;
}
