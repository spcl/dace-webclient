// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { graphlib } from '@dagrejs/dagre';


interface LayoutEdge {
    points?: { x: number; y: number }[];
}

interface EdgeLengthStats {
    variance: number;
    sum: number;
    min: number;
    max: number;
    mean: number;
    median: number;
}

interface EdgeBendStats {
    total: number;
    max: number;
}

export class LayoutEvaluator {

    public constructor(
        protected readonly graph: graphlib.Graph
    ) {}

    public getEdgeBendsStats(): EdgeBendStats {
        let bends = 0;
        let maxBends = 0;
        for (const eObj of this.graph.edges()) {
            const edge = this.graph.edge(
                eObj.v, eObj.w
            ) as LayoutEdge | undefined;
            if (edge?.points && edge.points.length > 2) {
                const simplified = [edge.points[0]];
                for (let i = 1; i < edge.points.length - 1; i++) {
                    const p0 = edge.points[i - 1];
                    const p1 = edge.points[i];
                    const p2 = edge.points[i + 1];
                    if (!(
                        (p0.x === p1.x && p1.x === p2.x) ||
                        (p0.y === p1.y && p1.y === p2.y)
                    ))
                        simplified.push(p1);
                }
                simplified.push(edge.points[edge.points.length - 1]);
                const nbends = Math.max(0, simplified.length - 2);
                if (nbends > maxBends)
                    maxBends = nbends;
                bends += nbends;
            }
        }
        return { total: bends, max: maxBends };
    }

    private pointDistance(
        p1: { x: number; y: number },
        p2: { x: number; y: number }
    ): number {
        return Math.hypot(p2.x - p1.x, p2.y - p1.y);
    }

    public getEdgeLengthStats(): EdgeLengthStats {
        const lengths: number[] = [];
        let maxLen = 0;
        let minLen = Number.POSITIVE_INFINITY;
        for (const eObj of this.graph.edges()) {
            const src = eObj.v;
            const dst = eObj.w;
            const edge = this.graph.edge(src, dst) as LayoutEdge | undefined;
            if (edge?.points) {
                let length = 0;
                for (let i = 1; i < edge.points.length; i++) {
                    length += this.pointDistance(
                        edge.points[i - 1], edge.points[i]
                    );
                }
                if (length > maxLen)
                    maxLen = length;
                if (length < minLen)
                    minLen = length;
                lengths.push(length);
            }
        }
        if (lengths.length === 0)
            return { variance: 0, min: 0, max: 0, sum: 0, mean: 0, median: 0 };
        const lengthSum = lengths.reduce((a, b) => a + b, 0);
        const mean = lengthSum / lengths.length;
        const variance = lengths.reduce((a, b) => a + (b - mean) ** 2, 0) /
            lengths.length;
        const median = lengths.sort((a, b) => a - b)[
            Math.floor(lengths.length / 2)
        ];
        return {
            variance,
            min: minLen,
            max: maxLen,
            sum: lengthSum,
            mean,
            median,
        };
    }

}
