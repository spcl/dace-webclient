// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { DiGraph } from '../graphlib/di_graph';
import { Graph } from '../graphlib/graph';
import type { SMLayouter, SMLayouterEdge, SMLayouterNode } from './sm_layouter';


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
            barycenter: 1,
            weight: 1,
            indegree: 0,
            outdegree: 0,
            in: [],
            out: [],
            vs: [entry.v],
            i: i,
        };
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

function findNewUniqueRootNode(
    graph: DiGraph<SMLayouterNode, SMLayouterEdge>
) {
    let i = 0;
    let root = '_root';
    while (graph.has(root))
        root = '_root' + (++i).toString();
    return root;
}

function buildLayerGraph(
    layouter: SMLayouter,
    rank: number,
    relationship: 'inEdges' | 'outEdges'
) {
    const graph = layouter.graph;
    const root = findNewUniqueRootNode(graph);
    const result = new DiGraph<SMLayouterNode, SMLayouterEdge>(undefined, true);

    //result.addNode(root);
    //graph.addNode(root);

    result.setData({ root: root });
    result.setDefaultNodeLabel((v: string) => graph.get(v));

    for (const nId of layouter.rankDict.get(rank) ?? []) {
        const parent = graph.parent(nId);
        result.addNode(nId);
        result.setParent(nId, parent ?? root);

        // This assumes we have only short edges!
        for (const edge of graph[relationship](nId)) {
            const src = edge[0][0] === nId ? edge[0][1] : edge[0][0];
            const dst = nId;
            const oEdge = result.hasEdge(src, dst) ?
                result.edge(src, dst) : undefined;
            const nEdge: SMLayouterEdge = {
                points: [],
                src: src,
                dst: dst,
                weight: oEdge?.weight ?? 0,
            };
            result.addEdge(src, nId, nEdge);
        }
    }

    return result;
}

function buildLayerGraphs(
    layouter: SMLayouter,
    ranks: number[],
    relationship: 'inEdges' | 'outEdges'
): DiGraph<SMLayouterNode, SMLayouterEdge>[] {
    return ranks.map(rank => buildLayerGraph(layouter, rank, relationship));
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
            const aIsDummy = a.startsWith('__smlayouter_dummy_') ? 1 : 0;
            const bIsDummy = b.startsWith('__smlayouter_dummy_') ? 1 : 0;
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
                return {
                    sum: acc.sum + ((edge.weight ?? 1) * nodeU.order!),
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
    const movable = graph.children(root);
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

function sweepLayerGraphs(
    layerGraphs: DiGraph<SMLayouterNode, SMLayouterEdge>[],
    biasRight: boolean
): void {
    const constraintsGraph = new Graph<SMLayouterNode, SMLayouterEdge>();
    for (const layerGraph of layerGraphs) {
        const root = (layerGraph.getData() as { root?: string }).root ?? '';
        const sorted = sortSubgraph(
            layerGraph, root, constraintsGraph, biasRight
        );
        sorted.vs?.forEach((nId, i) => layerGraph.get(nId)!.order = i);
        addSubgraphConstraints(layerGraph, constraintsGraph, sorted.vs ?? []);
    }
}

export function biasedMinCrossing(layouter: SMLayouter): void {
    // Initialize the ordering and assign order attributes accordingly.
    initializeOrdering(layouter.rankDict, layouter.graph, true);

    const maxRank = Math.max(...Array.from(layouter.rankDict.keys()));
    const downRanks = Array.from({ length: maxRank }, (_, i) => i + 1);
    const downLayerGraphs = buildLayerGraphs(layouter, downRanks, 'inEdges');
    const upRanks = Array.from({ length: maxRank }, (_, i) => maxRank - 1 - i);
    const upLayerGraphs = buildLayerGraphs(layouter, upRanks, 'outEdges');

    let bestCount = Number.POSITIVE_INFINITY;
    const bestOrdering = new Map<number, string[]>();
    for (const rank of layouter.rankDict.keys())
        bestOrdering.set(rank, [...(layouter.rankDict.get(rank) ?? [])]);

    for (let iter = 0, lastBest = 0; lastBest < 4; ++iter, ++lastBest) {
        sweepLayerGraphs(
            iter % 2 === 0 ? downLayerGraphs : upLayerGraphs,
            iter % 4 >= 2
        );

        const crossCount = countCrossings(layouter);
        if (crossCount < bestCount) {
            bestCount = crossCount;
            lastBest = 0;
            bestOrdering.clear();
            for (const rank of layouter.rankDict.keys()) {
                bestOrdering.set(
                    rank, [...(layouter.rankDict.get(rank) ?? [])]
                );
            }
        }
    }

    // Apply the best ordering found to the graph.
    layouter.rankDict.clear();
    for (const rank of bestOrdering.keys())
        layouter.rankDict.set(rank, [...bestOrdering.get(rank)!]);
    for (const rank of layouter.rankDict.keys()) {
        const nodes = layouter.rankDict.get(rank)!;
        for (let i = 0; i < nodes.length; i++)
            layouter.graph.get(nodes[i])!.order = i;
    }
}
