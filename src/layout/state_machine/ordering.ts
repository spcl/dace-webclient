// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { DummyState } from '../../renderer/sdfg/sdfg_elements';
import { DiGraph } from '../graphlib/di_graph';
import { Graph } from '../graphlib/graph';
import type {
    SMLayouter,
    SMLayouterEdge,
    SMLayouterNode,
} from './sm_layouter';


const N_IDLE_ITER = 4;

interface Barycenter {
    v?: string;
    barycenter?: number;
    weight?: number;
    vs?: string[];
    i?: number;
    merged?: boolean;
    in: Barycenter[];
    out: Barycenter[];
    indegree: number;
    outdegree: number;
}

export class SMLayouterOrdering {

    private _rootNr = 0;

    public constructor(
        private readonly layouter: SMLayouter
    ) {
    }

    private findNewUniqueRootNode(
        graph: DiGraph<SMLayouterNode, SMLayouterEdge>
    ) {
        let root = '_root';
        while (graph.has(root))
            root = '_root' + (++this._rootNr).toString();
        return root;
    }

    public buildLayerGraph(
        rank: number,
        relationship: 'inEdges' | 'outEdges'
    ): DiGraph<SMLayouterNode, SMLayouterEdge> {
        const graph = this.layouter.graph;
        const root = this.findNewUniqueRootNode(graph);
        const result = new DiGraph<SMLayouterNode, SMLayouterEdge>(
            undefined, true
        );

        result.setData({ root: root });
        result.setDefaultNodeLabel(
            (v: string) => graph.getWithDefault(v, undefined)
        );

        for (const nId of this.layouter.rankDict.get(rank) ?? []) {
            const parent = graph.parent(nId);
            result.addNode(nId);
            result.setParent(nId, parent ?? root);

            // This assumes we have only short edges!
            for (const edge of graph[relationship](nId)) {
                const src = edge[0][0] === nId ? edge[0][1] : edge[0][0];
                const dst = nId;
                let weight = 0;
                if (result.hasEdge(src, dst))
                    weight = result.edge(src, dst)?.weight ?? 0;
                const nEdge: SMLayouterEdge = {
                    points: [],
                    src: src,
                    dst: dst,
                    weight: weight + (edge[1]?.weight ?? 0),
                };
                result.addEdge(src, nId, nEdge);
            }
        }

        return result;
    }

    public buildLayerGraphs(
        ranks: number[],
        relationship: 'inEdges' | 'outEdges'
    ): DiGraph<SMLayouterNode, SMLayouterEdge>[] {
        return ranks.map(
            rank => this.buildLayerGraph(rank, relationship)
        );
    }

    public sweepLayerGraphs(
        layerGraphs: DiGraph<SMLayouterNode, SMLayouterEdge>[],
        biasRight: boolean
    ): void {
        const constraintsGraph = new Graph<SMLayouterNode, SMLayouterEdge>();
        // eslint-disable-next-line @typescript-eslint/prefer-for-of
        for (let i = 0; i < layerGraphs.length; i++) {
            const layerGraph = layerGraphs[i];
            const root = (layerGraph.getData() as { root?: string }).root ?? '';
            const sorted = sortSubgraph(
                layerGraph, root, constraintsGraph, biasRight
            );
            sorted.vs?.forEach((nId, i) => layerGraph.get(nId)!.order = i);
            addSubgraphConstraints(
                layerGraph, constraintsGraph, sorted.vs ?? []
            );
        }
    }

    public biasedMinCrossing(): void {
        // Initialize the ordering and assign order attributes accordingly.
        initializeOrdering(this.layouter.rankDict, this.layouter.graph, true);

        const maxRank = Math.max(...Array.from(this.layouter.rankDict.keys()));
        const downRanks = Array.from(
            { length: maxRank }, (_, i) => i + 1
        );
        const downLayerGraphs = this.buildLayerGraphs(downRanks, 'inEdges');
        const upRanks = Array.from(
            { length: maxRank }, (_, i) => maxRank - 1 - i
        );
        const upLayerGraphs = this.buildLayerGraphs(upRanks, 'outEdges');

        let bestCount = Number.POSITIVE_INFINITY;
        let bestPenalties = Number.POSITIVE_INFINITY;
        const bestOrdering = new Map<number, string[]>();
        for (const rank of this.layouter.rankDict.keys()) {
            bestOrdering.set(
                rank, [...(this.layouter.rankDict.get(rank) ?? [])]
            );
        }

        let iter = 0;
        let lastBest = 0;
        while (lastBest < N_IDLE_ITER) {
            // Perform a sweep to perform permutations.
            const biasRight = iter % 4 >= 2;
            this.sweepLayerGraphs(
                iter % 2 ? downLayerGraphs : upLayerGraphs,
                biasRight
            );

            // Re-assign the order attributes according to the new ordering.
            for (const rank of this.layouter.rankDict.keys()) {
                const sortedRankNodes = this.layouter.rankDict.get(rank)?.sort(
                    (a, b) => {
                        const aOrder = this.layouter.graph.get(a)?.order ?? 0;
                        const bOrder = this.layouter.graph.get(b)?.order ?? 0;
                        return aOrder - bOrder;
                    }
                ) ?? [];
                this.layouter.rankDict.set(rank, sortedRankNodes);
            }

            // Count the crossings.
            const crossCount = countCrossings(this.layouter);
            let nDummyPenalties = 0;
            for (const rnk of this.layouter.rankDict.keys()) {
                const nodes = this.layouter.rankDict.get(rnk) ?? [];
                let nDummiesFound = 0;
                for (const v of nodes) {
                    const nd = this.layouter.graph.get(v);
                    if (nd instanceof DummyState && !nd.forBackChain) {
                        nDummiesFound++;
                    } else {
                        if (nDummiesFound > 0)
                            nDummyPenalties += nDummiesFound;
                        nDummiesFound = 0;
                    }
                }
            }
            if (crossCount < bestCount || crossCount === bestCount &&
                nDummyPenalties < bestPenalties) {
                bestCount = crossCount;
                bestPenalties = nDummyPenalties;
                lastBest = 0;
                bestOrdering.clear();
                for (const rank of this.layouter.rankDict.keys()) {
                    bestOrdering.set(
                        rank, [...(this.layouter.rankDict.get(rank) ?? [])]
                    );
                }
            }

            iter++;
            lastBest++;
        }

        console.log(
            `Best crossing count: ${bestCount.toString()}`,
            `(penalties: ${bestPenalties.toString()})`
        );

        // Apply the best ordering found to the graph.
        this.layouter.rankDict.clear();
        for (const rank of bestOrdering.keys())
            this.layouter.rankDict.set(rank, [...bestOrdering.get(rank)!]);
        for (const rank of this.layouter.rankDict.keys()) {
            const nodes = this.layouter.rankDict.get(rank)!;
            for (let i = 0; i < nodes.length; i++)
                this.layouter.graph.get(nodes[i])!.order = i;
        }
    }

}

function sort(entries: Barycenter[], biasRight: boolean): Barycenter {
    const parts = {
        lhs: [] as Barycenter[],
        rhs: [] as Barycenter[],
    };
    entries.forEach(value => {
        if (value.barycenter !== undefined)
            parts.lhs.push(value);
        else
            parts.rhs.push(value);
    });
    const sortable = parts.lhs;
    const unsortable = parts.rhs.sort((a, b) => (b.i ?? 0) - (a.i ?? 0));
    const vs: string[] = [];
    let sum = 0;
    let weight = 0;
    let vsIndex = 0;

    sortable.sort(compareWithBias(!!biasRight));

    vsIndex = consumeUnsortable(vs, unsortable, vsIndex);

    sortable.forEach(entry => {
        if (entry.vs) {
            vsIndex += entry.vs.length;
            vs.push(...entry.vs);
        }
        if (entry.barycenter)
            sum += entry.barycenter * (entry.weight ?? 1);
        weight += entry.weight ?? 1;
        vsIndex = consumeUnsortable(vs, unsortable, vsIndex);
    });

    const result: Barycenter = {
        vs: vs,
        in: [],
        out: [],
        indegree: 0,
        outdegree: 0,
    };

    if (weight) {
        result.barycenter = sum / weight;
        result.weight = weight;
    }

    return result;
}

function consumeUnsortable(
    vs: string[], unsortable: Barycenter[], index: number
) {
    let last: Barycenter | undefined;
    while (
        unsortable.length &&
        ((last = unsortable[unsortable.length - 1]).i ?? 0) <= index
    ) {
        unsortable.pop();
        if (last.vs)
            vs.push(...last.vs);
        index++;
    }

    return index;
}

function compareWithBias(bias: boolean) {
    return (a: Barycenter, b: Barycenter) => {
        if (a.barycenter !== undefined && b.barycenter !== undefined) {
            if (a.barycenter < b.barycenter)
                return -1;
            else if (a.barycenter > b.barycenter)
                return 1;
        }

        return !bias ? (a.i ?? 0) - (b.i ?? 0) : (b.i ?? 0) - (a.i ?? 0);
    };
}

/*
 * Given a list of entries of the form {v, barycenter, weight} and a
 * constraint graph this function will resolve any conflicts between the
 * constraint graph and the barycenters for the entries. If the barycenters for
 * an entry would violate a constraint in the constraint graph then we coalesce
 * the nodes in the conflict into a new node that respects the contraint and
 * aggregates barycenter and weight information.
 *
 * This implementation is based on the description in Forster, "A Fast and
 * Simple Hueristic for Constrained Two-Level Crossing Reduction," thought it
 * differs in some specific details.
 *
 * Pre-conditions:
 *
 *    1. Each entry has the form {v, barycenter, weight}, or if the node has
 *       no barycenter, then {v}.
 *
 * Returns:
 *
 *    A new list of entries of the form {vs, i, barycenter, weight}. The list
 *    `vs` may either be a singleton or it may be an aggregation of nodes
 *    ordered such that they do not violate constraints from the constraint
 *    graph. The property `i` is the lowest original index of any of the
 *    elements in `vs`.
 */
function resolveConflicts(
    entries: Barycenter[], cg: Graph<unknown, unknown>
): Barycenter[] {
    const mappedEntries: Partial<Record<string, Barycenter>> = {};
    entries.forEach((entry, i) => {
        if (entry.v === undefined)
            return;
        const tmp = mappedEntries[entry.v] = {
            indegree: 0,
            outdegree: 0,
            in: [],
            out: [],
            vs: [entry.v],
            i: i,
        } as Barycenter;
        if (entry.barycenter !== undefined) {
            tmp.barycenter = entry.barycenter;
            tmp.weight = entry.weight ?? 1;
        }
    });

    cg.edges().forEach(e => {
        const entryV = mappedEntries[e[0][0]];
        const entryW = mappedEntries[e[0][1]];
        if (entryV !== undefined && entryW !== undefined) {
            entryW.indegree++;
            entryV.out.push(entryW);
        }
    });

    const sourceSet = Object.values(mappedEntries).filter(
        entry => entry && !entry.indegree
    ) as Barycenter[];

    return doResolveConflicts(sourceSet);
}

function doResolveConflicts(sourceSet: Barycenter[]): Barycenter[] {
    const entries: Barycenter[] = [];

    function handleIn(
        vEntry: Barycenter
    ): (uEntry: Barycenter) => void {
        return uEntry => {
            if (uEntry.merged)
                return;
            if (uEntry.barycenter === undefined ||
                vEntry.barycenter === undefined ||
                uEntry.barycenter >= vEntry.barycenter)
                mergeEntries(vEntry, uEntry);
        };
    }

    function handleOut(
        vEntry: Barycenter
    ): (wEntry: Barycenter) => void {
        return wEntry => {
            wEntry.in.push(vEntry);
            if (--wEntry.indegree === 0)
                sourceSet.push(wEntry);
        };
    }

    while (sourceSet.length) {
        const entry = sourceSet.pop();
        if (entry) {
            entries.push(entry);
            entry.in.reverse().forEach(handleIn(entry));
            entry.out.forEach(handleOut(entry));
        }
    }

    return entries.filter(entry => !entry.merged);
}

function mergeEntries(target: Barycenter, source: Barycenter) {
    let sum = 0;
    let weight = 0;

    if (target.weight) {
        sum += (target.barycenter ?? 1) * target.weight;
        weight += target.weight;
    }

    if (source.weight) {
        sum += (source.barycenter ?? 1) * source.weight;
        weight += source.weight;
    }

    target.vs = source.vs?.concat(target.vs ?? []);
    target.barycenter = sum / weight;
    target.weight = weight;
    target.i = Math.min(source.i ?? 0, target.i ?? 0);
    source.merged = true;
}

/**
 * Initialize the ordering of nodes within each rank to the order
 * they appear in the rank dictionary, but pushing any dummy nodes
 * to the end of the rank. This penalizes skip edgess (edges that
 * skip over ranks) and helps to keep them to the right side.
 * @note Thiss function modifies rankDict in place.
 * @param rankDict  The rank dictionary mapping ranks to lists of node IDs.
 * @param graph     The graph containing the nodes.
 * @param setOrder  Whether to set the 'order' attribute on nodes in the graph.
 */
function initializeOrdering(
    rankDict: Map<number, string[]>,
    graph: DiGraph<SMLayouterNode, SMLayouterEdge>,
    setOrder: boolean = true
): void {
    for (const rank of rankDict.keys()) {
        const nodes = rankDict.get(rank)!;
        nodes.sort((a, b) => {
            const ndA = graph.get(a);
            const ndB = graph.get(b);
            const aIsDummy = ndA instanceof DummyState ? 1 : 0;
            const bIsDummy = ndB instanceof DummyState ? 1 : 0;
            const aIsBEDummy = aIsDummy && (ndA as DummyState).forBackChain;
            const bIsBEDummy = bIsDummy && (ndB as DummyState).forBackChain;
            if (aIsBEDummy && bIsBEDummy)
                return 0;
            else if (aIsBEDummy && !bIsBEDummy)
                return -1;
            else if (!aIsBEDummy && bIsBEDummy)
                return 1;
            return aIsDummy - bIsDummy;
        });
        if (setOrder) {
            for (let i = 0; i < nodes.length; i++)
                graph.get(nodes[i])!.order = i;
        }
        rankDict.set(rank, nodes);
    }
}

function twoRankCrossCount(
    layouter: SMLayouter, upperRank: number, lowerRank: number
): number {
    const upperNodes = layouter.rankDict.get(upperRank) ?? [];
    const lowerNodes = layouter.rankDict.get(lowerRank) ?? [];

    // Sort all edges between the two ranks by their position in the upper
    // rank and the lower rank. Map these edges to the positions of their
    // target node in the lower rank.
    /*
    const lndMap = lowerNodes.map((v, i) => i);
    const lowerPositions = lowerNodes.reduce((acc, key, i) => {
        acc[key] = lndMap[i];
        return acc;
    }, {});
    */
    const lowerEntries = upperNodes.flatMap(u => {
        return layouter.graph.outEdges(u).map(e => {
            return {
                pos: lowerNodes.indexOf(e[0][1]),
                weight: layouter.graph.edge(e[0][0], e[0][1])?.weight ?? 1,
            };
        }).sort((a, b) => a.pos - b.pos);
    });

    // Build an accumulator tree.
    let firstIndex = 1;
    while (firstIndex < lowerNodes.length)
        firstIndex <<= 1;
    const treeSize = 2 * firstIndex - 1;
    firstIndex -= 1;
    const tree = new Array<number>(treeSize).fill(0);

    // Calculate the weighted crussing sum.
    let crossCount = 0;
    for (const entry of lowerEntries) {
        let idx = firstIndex + entry.pos;
        tree[idx] += entry.weight;
        let weightSum = 0;
        while (idx > 0) {
            if (idx % 2)
                weightSum += tree[idx + 1];
            idx = (idx - 1) >> 1;
            tree[idx] += entry.weight;
        }
        crossCount += weightSum * entry.weight;
    }
    return crossCount;
}

function countCrossings(layouter: SMLayouter): number {
    let count = 0;
    for (let rank = 1; rank < layouter.rankDict.size; rank++)
        count += twoRankCrossCount(layouter, rank - 1, rank);
    return count;
}

function barycenter(
    graph: DiGraph<SMLayouterNode, SMLayouterEdge>,
    movable: string[] = []
): Barycenter[] {
    return movable.map(v => {
        const inV = graph.inEdges(v);
        if (!inV.length) {
            return {
                v: v,
                out: [],
                in: [],
                indegree: 0,
                outdegree: 0,
            };
        } else {
            const result = inV.reduce((acc, e) => {
                const edge = graph.edge(e[0][0], e[0][1])!;
                const nodeU = graph.get(e[0][0])!;
                const nodeWeight = nodeU instanceof DummyState ? 2 : 1;
                return {
                    sum: acc.sum + (
                        (edge.weight ?? 1) * nodeU.order!
                    ) * nodeWeight,
                    weight: acc.weight + (edge.weight ?? 1),
                    out: [],
                    in: [],
                    indegree: 0,
                    outdegree: 0,
                };
            }, { sum: 0, weight: 0 });

            return {
                v: v,
                barycenter: result.sum / result.weight,
                weight: result.weight,
                out: [],
                in: [],
                indegree: 0,
                outdegree: 0,
            };
        }
    });
}

function mergeBarycenters(target: Barycenter, other: Barycenter) {
    if (target.barycenter !== undefined) {
        const tBc = target.barycenter;
        const tWg = target.weight ?? 1;
        const oBc = other.barycenter ?? 1;
        const oWg = other.weight ?? 1;
        target.barycenter = (tBc * tWg + oBc * oWg) / (tWg + oWg);
        target.weight ??= 1;
        target.weight += oWg;
    } else {
        target.barycenter = other.barycenter;
        target.weight = other.weight;
    }
}

function sortSubgraph(
    graph: DiGraph<SMLayouterNode, SMLayouterEdge>,
    root: string,
    constraintsGraph: Graph<unknown, unknown>,
    biasRight: boolean
): Barycenter {
    const movable = [];
    const immovable = [];
    for (const n of graph.children(root)) {
        const nd = graph.get(n);
        if (nd instanceof DummyState && nd.forBackChain)
            immovable.push(n);
        else
            movable.push(n);
    }
    const subgraphs: Partial<Record<string, Barycenter>> = {};

    const barycenters = barycenter(graph, movable);
    barycenters.forEach(entry => {
        if (entry.v && graph.children(entry.v).length) {
            const subgraphResult = sortSubgraph(
                graph, entry.v, constraintsGraph, biasRight
            );
            subgraphs[entry.v] = subgraphResult;
            if (subgraphResult.barycenter !== undefined)
                mergeBarycenters(entry, subgraphResult);
        }
    });

    const entries = resolveConflicts(barycenters, constraintsGraph);
    for (const entry of entries) {
        entry.vs = entry.vs?.flatMap(v => {
            const subgraph = subgraphs[v];
            if (subgraph)
                return subgraph.vs ?? [];
            return v;
        }) ?? [];
    }

    let i = -immovable.length;
    for (const nd of immovable) {
        entries.push({
            barycenter: undefined,
            v: nd,
            vs: [nd],
            in: [],
            out: [],
            indegree: 0,
            outdegree: 0,
            i: i,
        });
        i++;
    }

    return sort(entries, biasRight);
}

function addSubgraphConstraints(
    graph: Graph<SMLayouterNode, SMLayouterEdge>,
    constraintsGraph: Graph<SMLayouterNode, SMLayouterEdge>,
    vs: string[]
): void {
    const prev: Partial<Record<string, string>> = {};
    let rootPrev: string | undefined;

    vs.forEach(v => {
        let child = graph.parent(v);
        let parent;
        let prevChild;
        while (child) {
            parent = graph.parent(child);
            if (parent) {
                prevChild = prev[parent];
                prev[parent] = child;
            } else {
                prevChild = rootPrev;
                rootPrev = child;
            }
            if (prevChild && prevChild !== child) {
                constraintsGraph.addEdge(prevChild, child);
                return;
            }
            child = parent;
        }
    });
}
