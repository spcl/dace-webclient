// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { graphlib } from '@dagrejs/dagre';
import {
    ptLineDistance,
} from 'rendure/src/renderer/core/common/renderer_utils';
import { Point2D } from '../types';


interface LayoutEdge {
    points?: { x: number; y: number }[];
}

interface EdgeLengthStats {
    variance: number;
    mad: number;
    log_mad: number;
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

export class StatsCollector {

    private static readonly INSTANCE: StatsCollector = new StatsCollector();

    private constructor() {
        return;
    }

    public static getInstance(): StatsCollector {
        return this.INSTANCE;
    }

    private statsRows: number[][] = [];

    public clearStats(): void {
        this.statsRows = [];
    }

    public addStatsColum(column: number[]): void {
        if (this.statsRows.length === 0) {
            for (const _v of column)
                this.statsRows.push([]);
        }
        if (this.statsRows.length !== column.length)
            throw new Error('StatsCollector: Mismatched number of rows');

        for (let i = 0; i < column.length; i++)
            this.statsRows[i].push(column[i]);
    }

    private save(filename: string, contents?: string): void {
        if (!contents)
            return;
        const link = document.createElement('a');
        link.setAttribute('download', filename);
        link.href = contents;
        document.body.appendChild(link);

        // Wait for the link to be added to the document, then click it.
        window.requestAnimationFrame(() => {
            const event = new MouseEvent('click');
            link.dispatchEvent(event);
            document.body.removeChild(link);
        });
    }

    public dumpStatsCSV(filename: string): void {
        const csvContent = 'data:text/csv;charset=utf-8,';
        let data = '';
        for (const row of this.statsRows) {
            const rowStr = row.map((v) => v.toString()).join(',');
            data += rowStr + '\n';
        }
        this.save(filename, csvContent + encodeURIComponent(data));
    }

}

export class LayoutEvaluator {

    private static readonly IDEAL_EDGE_LENGTH = 50.0;

    public constructor(
        protected readonly graph: graphlib.Graph
    ) {}

    public getNodeOrthoScore(
        boundingBox: { x: number, y: number, w: number, h: number }
    ): number {
        const gridWidth = Math.floor(boundingBox.w / 100);
        const gridHeight = Math.floor(boundingBox.h / 100);
        const gridSize = (gridWidth + 1) * (gridHeight + 1);
        const nNodes = this.graph.nodes().length;
        return nNodes / gridSize;
    }

    public getEdgeOrthoScore(): number {
        const allEdges: { x: number, y: number }[][] = [];
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
                allEdges.push(simplified);
            }
        }
        return calcEdgeOrthoScore(allEdges);
    }

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
                if (length > 0)
                    lengths.push(length);
            }
        }
        if (lengths.length === 0) {
            return {
                variance: 0,
                mad: 0,
                log_mad: 0,
                min: 0,
                max: 0,
                sum: 0,
                mean: 0,
                median: 0,
            };
        }
        const logLengths = lengths.map((l) => Math.log(l));
        const lengthSum = lengths.reduce((a, b) => a + b, 0);
        const mean = lengthSum / lengths.length;
        const variance = lengths.reduce(
            (a, b) => a + (b - mean) ** 2, 0
        ) / lengths.length;
        const median = lengths.sort((a, b) => a - b)[
            Math.floor(lengths.length / 2)
        ];
        const logMedian = logLengths.sort((a, b) => a - b)[
            Math.floor(logLengths.length / 2)
        ];
        const logMedianAbsoluteDev = logLengths.reduce(
            (a, b) => a + Math.abs(b - logMedian), 0
        ) / logLengths.length;
        const medianAbsoluteDev = lengths.reduce(
            (a, b) => a + Math.abs(b - median), 0
        ) / lengths.length;
        return {
            variance,
            mad: medianAbsoluteDev,
            log_mad: logMedianAbsoluteDev,
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

    public calcBundlingDist(): { medianBw: number, medianFw: number } {
        const res = { medianBw: 0, medianFw: 0 };

        const backEdges = [];
        const forwardEdges = [];
        for (const eObj of this.graph.edges()) {
            const src = this.graph.node(eObj.v);
            const dst = this.graph.node(eObj.w);
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

                if (dst.y < src.y) {
                    console.log(`Back edge from ${eObj.v} to ${eObj.w}`);
                    backEdges.push(simplified);
                } else if (
                    dst.y > src.y + LayoutEvaluator.IDEAL_EDGE_LENGTH + 20
                ) {
                    forwardEdges.push(simplified);
                }
            }
        }

        console.log(forwardEdges);
        console.log(backEdges);

        console.log(`Found ${backEdges.length.toString()} back edges`);
        console.log(`Found ${forwardEdges.length.toString()} forward edges`);

        const backDists = [];
        for (let i = 0; i < backEdges.length; i++) {
            const edgeA = backEdges[i];
            const aMinY = Math.min(...edgeA.map(p => p.y));
            const aMaxY = Math.max(...edgeA.map(p => p.y));
            for (let j = i + 1; j < backEdges.length; j++) {
                const edgeB = backEdges[j];
                const bMinY = Math.min(...edgeB.map(p => p.y));
                const bMaxY = Math.max(...edgeB.map(p => p.y));
                // Skip if vertical ranges do not overlap
                if (aMaxY < bMinY || bMaxY < aMinY)
                    continue;
                let minDist = Number.POSITIVE_INFINITY;
                for (let ia = 1; ia < edgeA.length; ia++) {
                    const pA1 = edgeA[ia - 1];
                    const pA2 = edgeA[ia];
                    for (let ib = 1; ib < edgeB.length; ib++) {
                        const pB1 = edgeB[ib - 1];
                        const pB2 = edgeB[ib];
                        const distRes = distanceSegmentToSegment2D(
                            pA1, pA2, pB1, pB2
                        );
                        if (distRes.distance < minDist)
                            minDist = distRes.distance;
                    }
                }
                backDists.push(minDist);
            }
        }

        const forwardDists = [];
        for (let i = 0; i < forwardEdges.length; i++) {
            const edgeA = forwardEdges[i];
            const aMinY = Math.min(...edgeA.map(p => p.y));
            const aMaxY = Math.max(...edgeA.map(p => p.y));
            for (let j = i + 1; j < forwardEdges.length; j++) {
                const edgeB = forwardEdges[j];
                const bMinY = Math.min(...edgeB.map(p => p.y));
                const bMaxY = Math.max(...edgeB.map(p => p.y));
                // Skip if vertical ranges do not overlap
                if (aMaxY < bMinY || bMaxY < aMinY)
                    continue;
                let minDist = Number.POSITIVE_INFINITY;
                for (let ia = 1; ia < edgeA.length; ia++) {
                    const pA1 = edgeA[ia - 1];
                    const pA2 = edgeA[ia];
                    for (let ib = 1; ib < edgeB.length; ib++) {
                        const pB1 = edgeB[ib - 1];
                        const pB2 = edgeB[ib];
                        const distRes = distanceSegmentToSegment2D(
                            pA1, pA2, pB1, pB2
                        );
                        if (distRes.distance < minDist)
                            minDist = distRes.distance;
                    }
                }
                forwardDists.push(minDist);
            }
        }

        res.medianBw = backDists.length > 0 ? backDists.sort((a, b) => a - b)[
            Math.floor(backDists.length / 2)
        ] : 0;
        res.medianFw = forwardDists.length > 0 ? forwardDists.sort(
            (a, b) => a - b
        )[
            Math.floor(forwardDists.length / 2)
        ] : 0;

        console.log(`Median bundling dist (back): ${res.medianBw.toString()}`);
        console.log(`Median bundling dist (forw): ${res.medianFw.toString()}`);

        return res;
    }

}

function angleToXAxis(
    p1: { x: number, y: number }, p2: { x: number, y: number }
): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    let thetaDeg = Math.atan2(dy, dx) * (180 / Math.PI);

    // Normalize to [0, 180]
    if (thetaDeg < 0)
        thetaDeg += 180;
    else if (thetaDeg > 180)
        thetaDeg -= 180;

    return thetaDeg;
}

function getEdgeSegmentOrthoScore(
    p1: { x: number, y: number }, p2: { x: number, y: number }
): number {
    const theta = angleToXAxis(p1, p2);
    return Math.min(theta, Math.abs(90 - theta), Math.abs(180 - theta)) / 45.0;
}

function calcEdgeOrthoScore(edges: { x: number, y: number }[][]): number {
    if (edges.length === 0)
        return 1.0;

    const scores: number[] = [];

    for (const edge of edges) {
        for (let i = 1; i < edge.length; i++) {
            const p1 = edge[i - 1];
            const p2 = edge[i];
            scores.push(getEdgeSegmentOrthoScore(p1, p2));
        }
    }

    const meanScore = scores.length > 0 ?
        scores.reduce((sum, score) => sum + score, 0) / scores.length :
        1.0;

    return 1.0 - meanScore;
}

const EPS = 1e-9;

const sub = (a: Point2D, b: Point2D): Point2D => ({
    x: a.x - b.x,
    y: a.y - b.y,
});
const dot = (a: Point2D, b: Point2D): number => a.x * b.x + a.y * b.y;
/** 2D cross product's scalar (z-component) of vectors a and b */
const cross = (a: Point2D, b: Point2D): number => a.x * b.y - a.y * b.x;
const norm2 = (a: Point2D): number => dot(a, a);
const len = (a: Point2D): number => Math.hypot(a.x, a.y);
const clamp = (t: number, lo: number, hi: number): number => Math.max(
    lo, Math.min(hi, t)
);

/**
 * Shortest distance between two infinite 2D lines L1=(p1,q1), L2=(p2,q2).
 * If they are not parallel, they intersect => distance = 0.
 * If parallel, distance = perpendicular distance from any point on one line to
 * the other line.
 * Handles degenerate cases where a "line" collapses to a point.
 */
export function distanceLineToLine2D(
    p1: Point2D, q1: Point2D, p2: Point2D, q2: Point2D
): number {
    const d1 = sub(q1, p1);
    const d2 = sub(q2, p2);
    const d1Len = len(d1);
    const d2Len = len(d2);

    // Degenerate cases:
    if (d1Len < EPS && d2Len < EPS) {
        // both are points
        return len(sub(p1, p2));
    }
    if (d1Len < EPS) {
        // L1 is a point; distance to line L2
        return distancePointToInfiniteLine(p1, p2, q2);
    }
    if (d2Len < EPS) {
        // L2 is a point; distance to line L1
        return distancePointToInfiniteLine(p2, p1, q1);
    }

    // Check parallelism via cross product magnitude
    const denom = Math.abs(cross(d1, d2));
    if (denom > EPS) {
        // Not parallel => intersect at one point => shortest distance is 0.
        return 0;
    }

    // Parallel: distance from p2 to L1
    return distancePointToInfiniteLine(p2, p1, q1);
}

/** Perpendicular distance from point p to infinite line (a,b). */
export function distancePointToInfiniteLine(
    p: Point2D, a: Point2D, b: Point2D
): number {
    const ab = sub(b, a);
    const abLen = len(ab);
    if (abLen < EPS)
        return len(sub(p, a)); // line collapses to point
    // Area formula: |cross(ab, ap)| / |ab|
    const ap = sub(p, a);
    return Math.abs(cross(ab, ap)) / abLen;
}

export interface ClosestResult {
  distance: number;
  closestOnAB: Point2D;
  closestOnCD: Point2D;
}

/**
 * Shortest distance between two 2D segments AB and CD, with closest points.
 */
export function distanceSegmentToSegment2D(
    A: Point2D, B: Point2D,
    C: Point2D, D: Point2D
): ClosestResult {
    // If they intersect, distance is zero and the closest point is any
    // intersection point.
    const inter = segmentIntersectionPoint(A, B, C, D);
    if (inter)
        return { distance: 0, closestOnAB: inter, closestOnCD: inter };

    // Otherwise, minimum of endpoint-to-segment distances:
    const r1 = closestPointOnSegment(C, A, B);
    const r2 = closestPointOnSegment(D, A, B);
    const r3 = closestPointOnSegment(A, C, D);
    const r4 = closestPointOnSegment(B, C, D);

    let best = r1;
    if (r2.distance < best.distance)
        best = r2;
    if (r3.distance < best.distance)
        best = r3;
    if (r4.distance < best.distance)
        best = r4;

    return best;
}

/**
 * Closest point from P to segment AB, returning both the point and the
 * distance.
 */
export function closestPointOnSegment(
    P: Point2D, A: Point2D, B: Point2D
): ClosestResult {
    const AB = sub(B, A);
    const AB2 = norm2(AB);
    if (AB2 < EPS) {
        // Segment reduces to a point
        const dist = len(sub(P, A));
        // "closestOnCD" used as input point holder
        return { distance: dist, closestOnAB: A, closestOnCD: P };
    }
    const t = clamp(dot(sub(P, A), AB) / AB2, 0, 1);
    const proj: Point2D = { x: A.x + t * AB.x, y: A.y + t * AB.y };
    const dist = len(sub(P, proj));
    return { distance: dist, closestOnAB: proj, closestOnCD: P };
}

/**
 * Optional utility: returns true if segments AB and CD intersect (including
 * colinear overlap), and if so, returns one intersection point (for overlap we
 * return a representative point).
 */
export function segmentIntersectionPoint(
    A: Point2D, B: Point2D, C: Point2D, D: Point2D
): Point2D | null {
    // Handle degenerate segments as points
    const AB = sub(B, A);
    const CD = sub(D, C);
    const ABlen2 = norm2(AB);
    const CDlen2 = norm2(CD);

    if (ABlen2 < EPS && CDlen2 < EPS) {
        // Both are points
        return len(sub(A, C)) < EPS ? A : null;
    }
    if (ABlen2 < EPS) {
        // A==B is a point; check if it lies on segment CD
        return pointOnSegment(A, C, D) ? A : null;
    }
    if (CDlen2 < EPS) {
        // C==D is a point; check if it lies on segment AB
        return pointOnSegment(C, A, B) ? C : null;
    }

    const r = AB;
    const s = CD;
    const rxs = cross(r, s);
    const qP = sub(C, A);
    const qPxr = cross(qP, r);

    if (Math.abs(rxs) < EPS && Math.abs(qPxr) < EPS) {
        // Colinear: check overlap by projection on x or y
        const t0 = dot(qP, r) / norm2(r);
        const t1 = t0 + dot(s, r) / norm2(r);
        const [tmin, tmax] = [Math.min(t0, t1), Math.max(t0, t1)];
        const overlap = !(tmax < 0 || tmin > 1);
        if (!overlap)
            return null;

        // Return a representative overlapping point (clamped midpoint)
        const t = clamp((Math.max(0, tmin) + Math.min(1, tmax)) / 2, 0, 1);
        return { x: A.x + t * r.x, y: A.y + t * r.y };
    }

    if (Math.abs(rxs) < EPS && Math.abs(qPxr) >= EPS) {
        // Parallel, non-intersecting
        return null;
    }

    // Compute intersection parameters t and u for A + t r and C + u s
    const t = cross(qP, s) / rxs;
    const u = cross(qP, r) / rxs;

    if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) {
        // Intersection inside segments
        return { x: A.x + t * r.x, y: A.y + t * r.y };
    }
    return null;
}

function pointOnSegment(P: Point2D, A: Point2D, B: Point2D): boolean {
    const AP = sub(P, A);
    const AB = sub(B, A);
    if (Math.abs(cross(AP, AB)) > EPS)
        return false; // not colinear
    const dotProd = dot(AP, AB);
    if (dotProd < -EPS)
        return false;
    if (dotProd > norm2(AB) + EPS)
        return false;
    return true;
}
