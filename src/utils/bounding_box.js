// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

export function calculateBoundingBox(g) {
    // iterate over all objects, calculate the size of the bounding box
    const bb = {};
    bb.width = 0;
    bb.height = 0;

    g.nodes().forEach((v) => {
        const x = g.node(v).x + g.node(v).width / 2.0;
        const y = g.node(v).y + g.node(v).height / 2.0;
        if (x > bb.width) bb.width = x;
        if (y > bb.height) bb.height = y;
    });

    return bb;
}

export function boundingBox(elements) {
    const bb = { x1: null, y1: null, x2: null, y2: null };

    elements.forEach((v) => {
        const topleft = v.topleft();
        if (bb.x1 === null || topleft.x < bb.x1) bb.x1 = topleft.x;
        if (bb.y1 === null || topleft.y < bb.y1) bb.y1 = topleft.y;

        const x2 = v.x + v.width / 2.0;
        const y2 = v.y + v.height / 2.0;

        if (bb.x2 === null || x2 > bb.x2) bb.x2 = x2;
        if (bb.y2 === null || y2 > bb.y2) bb.y2 = y2;
    });

    return { x: bb.x1, y: bb.y1, width: bb.x2 - bb.x1, height: bb.y2 - bb.y1 };
}

export function calculateEdgeBoundingBox(edge) {
    // iterate over all points, calculate the size of the bounding box
    let bb = {};
    bb.x1 = edge.points[0].x;
    bb.y1 = edge.points[0].y;
    bb.x2 = edge.points[0].x;
    bb.y2 = edge.points[0].y;

    edge.points.forEach((p) => {
        bb.x1 = p.x < bb.x1 ? p.x : bb.x1;
        bb.y1 = p.y < bb.y1 ? p.y : bb.y1;
        bb.x2 = p.x > bb.x2 ? p.x : bb.x2;
        bb.y2 = p.y > bb.y2 ? p.y : bb.y2;
    });

    bb = {
        'x': bb.x1, 'y': bb.y1, 'width': (bb.x2 - bb.x1),
        'height': (bb.y2 - bb.y1)
    };
    if (bb.width <= 5) {
        bb.width = 10;
        bb.x -= 5;
    }
    if (bb.height <= 5) {
        bb.height = 10;
        bb.y -= 5;
    }
    return bb;
}

export function updateEdgeBoundingBox(edge) {
    const bb = calculateEdgeBoundingBox(edge);
    edge.x = bb.x + bb.width / 2;
    edge.y = bb.y + bb.height / 2;
    edge.width = bb.width;
    edge.height = bb.height;
}
