// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { graphlib } from '@dagrejs/dagre';
import {
    ptLineDistance,
} from 'rendure/src/renderer/core/common/renderer_utils';


interface LayoutEdge {
    points?: { x: number; y: number }[];
}

interface EdgeLengthStats {
    variance: number;
    mad: number;
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

interface SymmetryStats {
    vertical: number;
    horizontal: number;
    diagonalTLBR: number;
    diagonalBLTR: number;
    overall: number;
    boundingBox: { x: number; y: number; w: number; h: number };
}

export class LayoutEvaluator {

    private static readonly IDEAL_EDGE_LENGTH = 50.0;

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
        if (lengths.length === 0) {
            return {
                variance: 0,
                mad: 0,
                min: 0,
                max: 0,
                sum: 0,
                mean: 0,
                median: 0,
            };
        }
        const lengthSum = lengths.reduce((a, b) => a + b, 0);
        const mean = lengthSum / lengths.length;
        const variance = lengths.reduce(
            (a, b) => a + (b - mean) ** 2, 0
        ) / lengths.length;
        const median = lengths.sort((a, b) => a - b)[
            Math.floor(lengths.length / 2)
        ];
        const medianAbsoluteDev = lengths.reduce(
            (a, b) => a + Math.abs(b - median), 0
        ) / lengths.length;
        return {
            variance,
            mad: medianAbsoluteDev,
            min: minLen,
            max: maxLen,
            sum: lengthSum,
            mean,
            median,
        };
    }

    private isAboveLine(
        p: { x: number; y: number },
        line: { u: { x: number; y: number }; v: { x: number; y: number } }
    ): boolean {
        const slope = (line.v.y - line.u.y) / (line.v.x - line.u.x);
        const yOnLine = line.u.y + slope * (p.x - line.u.x);
        return p.y >= yOnLine;
    }

    public getSymmetryScore(): SymmetryStats {
        const nodes = this.graph.nodes().map((n) => this.graph.node(n));
        const bb = {
            x1: Number.POSITIVE_INFINITY,
            y1: Number.POSITIVE_INFINITY,
            x2: Number.NEGATIVE_INFINITY,
            y2: Number.NEGATIVE_INFINITY,
        };
        nodes.forEach(n => {
            const x1 = n.x - n.width / 2.0;
            const y1 = n.y - n.height / 2.0;
            const x2 = n.x + n.width / 2.0;
            const y2 = n.y + n.height / 2.0;
            if (x1 < bb.x1)
                bb.x1 = x1;
            if (y1 < bb.y1)
                bb.y1 = y1;
            if (x2 > bb.x2)
                bb.x2 = x2;
            if (y2 > bb.y2)
                bb.y2 = y2;
        });

        const boundingBoxRect = {
            x: bb.x1,
            y: bb.y1,
            w: bb.x2 - bb.x1,
            h: bb.y2 - bb.y1,
        };

        const symmetryLines: Record<string, {
            u: { x: number; y: number },
            v: { x: number; y: number },
        }> = {
            horizontal: {
                u: {
                    x: boundingBoxRect.x,
                    y: boundingBoxRect.y + boundingBoxRect.h / 2,
                },
                v: {
                    x: boundingBoxRect.x + boundingBoxRect.w,
                    y: boundingBoxRect.y + boundingBoxRect.h / 2,
                },
            },
            vertical: {
                u: {
                    x: boundingBoxRect.x + boundingBoxRect.w / 2,
                    y: boundingBoxRect.y,
                },
                v: {
                    x: boundingBoxRect.x + boundingBoxRect.w / 2,
                    y: boundingBoxRect.y + boundingBoxRect.h,
                },
            },
            diagonalTLBR: {
                u: {
                    x: boundingBoxRect.x,
                    y: boundingBoxRect.y,
                },
                v: {
                    x: boundingBoxRect.x + boundingBoxRect.w,
                    y: boundingBoxRect.y + boundingBoxRect.h,
                },
            },
            diagonalBLTRLine: {
                u: {
                    x: boundingBoxRect.x,
                    y: boundingBoxRect.y + boundingBoxRect.h,
                },
                v: {
                    x: boundingBoxRect.x + boundingBoxRect.w,
                    y: boundingBoxRect.y,
                },
            },
        };

        const horizontalDistances = [];
        for (const node of nodes) {
            const line = symmetryLines.horizontal;
            const p1 = { x: node.x, y: node.y };
            const distance = ptLineDistance(p1, line.u, line.v);
            if (p1.y < line.u.y)
                horizontalDistances.push(-distance);
            else
                horizontalDistances.push(distance);
        }
        const verticalDistances = [];
        for (const node of nodes) {
            const line = symmetryLines.vertical;
            const p1 = { x: node.x, y: node.y };
            const distance = ptLineDistance(p1, line.u, line.v);
            if (p1.x < line.u.x)
                verticalDistances.push(-distance);
            else
                verticalDistances.push(distance);
        }
        const diagonalTLBRDistances = [];
        for (const node of nodes) {
            const line = symmetryLines.diagonalTLBR;
            const p1 = { x: node.x, y: node.y };
            const distance = ptLineDistance(p1, line.u, line.v);
            if (!this.isAboveLine(p1, line))
                diagonalTLBRDistances.push(-distance);
            else
                diagonalTLBRDistances.push(distance);
        }
        const diagonalBLTRDistances = [];
        for (const node of nodes) {
            const line = symmetryLines.diagonalBLTRLine;
            const p1 = { x: node.x, y: node.y };
            const distance = ptLineDistance(p1, line.u, line.v);
            if (!this.isAboveLine(p1, line))
                diagonalBLTRDistances.push(-distance);
            else
                diagonalBLTRDistances.push(distance);
        }

        const symmetryScores = {
            vertical: verticalDistances.reduce(
                (a, b) => a + b, 0
            ) / nodes.length,
            horizontal: horizontalDistances.reduce(
                (a, b) => a + b, 0
            ) / nodes.length,
            diagonalTLBR: diagonalTLBRDistances.reduce(
                (a, b) => a + b, 0
            ) / nodes.length,
            diagonalBLTR: diagonalBLTRDistances.reduce(
                (a, b) => a + b, 0
            ) / nodes.length,
        };

        return {
            ...symmetryScores,
            overall: (
                Math.abs(symmetryScores.vertical) +
                Math.abs(symmetryScores.horizontal) +
                Math.abs(symmetryScores.diagonalTLBR) +
                Math.abs(symmetryScores.diagonalBLTR)
            ) / 4.0,
            boundingBox: boundingBoxRect,
        };
    }

    /**
     * Calculates per-node force sums based on repulsive and attractive forces.
     * @param nodePositions Object mapping node IDs to {x, y} positions
     * @returns Object mapping node IDs to force magnitudes
     */
    public calcForces(): Map<string, number> {
        const nodeForces: Record<string, { x: number; y: number }> = {};
        for (const nodeId of this.graph.nodes())
            nodeForces[nodeId] = { x: 0, y: 0 };

        // Repulsive forces between all pairs of nodes
        for (const aId of this.graph.nodes()) {
            for (const bId of this.graph.nodes()) {
                if (aId !== bId) {
                    const nodeA = this.graph.node(aId);
                    const nodeB = this.graph.node(bId);
                    const deltaX = nodeA.x - nodeB.x;
                    const deltaY = nodeA.y - nodeB.y;
                    const distance = Math.hypot(deltaX, deltaY);
                    if (distance <= 0)
                        continue;
                    const directionX = deltaX / distance;
                    const directionY = deltaY / distance;
                    const forceMagnitude = Math.log((
                        LayoutEvaluator.IDEAL_EDGE_LENGTH ** 2
                    ) / distance);
                    nodeForces[aId].x += directionX * forceMagnitude;
                    nodeForces[aId].y += directionY * forceMagnitude;
                }
            }
        }
        // Attractive forces for each edge
        for (const edgeObj of this.graph.edges()) {
            const src = this.graph.node(edgeObj.v);
            const dst = this.graph.node(edgeObj.w);
            const deltaX = dst.x - src.x;
            const deltaY = dst.y - src.y;
            const distance = Math.hypot(deltaX, deltaY);
            if (distance <= 0)
                continue;
            const directionX = deltaX / distance;
            const directionY = deltaY / distance;
            const forceMagnitude = Math.log((
                distance ** 2
            ) / LayoutEvaluator.IDEAL_EDGE_LENGTH);
            nodeForces[edgeObj.v].x += directionX * forceMagnitude;
            nodeForces[edgeObj.v].y += directionY * forceMagnitude;
            nodeForces[edgeObj.w].x -= directionX * forceMagnitude;
            nodeForces[edgeObj.w].y -= directionY * forceMagnitude;
        }

        // Compute per-node force magnitudes
        const perNodeForceSums = new Map<string, number>();
        for (const nodeId of Object.keys(nodeForces)) {
            const force = nodeForces[nodeId];
            perNodeForceSums.set(nodeId, Math.hypot(force.x, force.y));
        }
        return perNodeForceSums;
    }

}
