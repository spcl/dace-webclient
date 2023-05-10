import { DagreSDFG } from '../..';
import * as dagre from 'dagre';
import { allBackedges } from '../graphlib/algorithms/cycles';
import {
    dominatorTree,
    immediateDominators,
} from '../graphlib/algorithms/dominance';
import { DiGraph } from '../graphlib/di_graph';

const dagreOrder = require('dagre/lib/order');

const ARTIFICIAL_START = '__smlayouter_artifical_start';
const ARTIFICIAL_END = '__smlayouter_artifical_end';

const LAYER_SPACING = 50;
const NODE_SPACING = 50;

enum ScopeType {
    BRANCH,
    LOOP_REGULAR,
    LOOP_INVERTED,
}

export interface SMLayouterNode {
    width: number;
    height: number;
    x: number;
    y: number;
    order?: number;
}

export interface SMLayouterEdge {
    points: { x: number, y: number }[];
}

export class SMLayouter {

    private readonly graph: DiGraph<SMLayouterNode, SMLayouterEdge>;
    private readonly startNode: string;
    private readonly endNode: string;
    private readonly iDoms: Map<string, string>;
    private readonly iPostDoms: Map<string, string>;
    private readonly allDom: Map<string, Set<string>>;
    private readonly domTree: DiGraph<{ level: number }, unknown>;
    private readonly allPostDom: Map<string, Set<string>>;
    private readonly postDomTree: DiGraph<{ level: number }, unknown>;
    private readonly backedges: Set<[string, string]>;
    private readonly backedgesDstDict: Map<string, Set<[string, string]>>;
    private readonly eclipsedBackedges: Set<[string, string]>;
    private readonly eclipsedBackedgesDstDict: Map<
        string, Set<[string, string]>
    >;
    private readonly backedgesCombined: Set<[string, string]>;
    private readonly rankDict: Map<number, string[]>;
    private readonly rankHeights: Map<number, number>;
    private readonly nodeRanks: Map<string, number>;
    private readonly dummyChains: Set<[SMLayouterEdge, string[]]>;

    public constructor(g: DiGraph<SMLayouterNode, SMLayouterEdge>) {
        this.graph = g;

        // Preparation phase.
        const inverted = this.graph.reversed();
        const sources = this.graph.sources();
        const sinks = this.graph.sinks();

        if (sources.length > 1) {
            console.warn(
                'State machine has multiple possible sources. ' +
                'Using an artificial source node for layouting.'
            );
            this.startNode = ARTIFICIAL_START;
            this.graph.addNode(this.startNode);
            for (const s of sources)
                this.graph.addEdge(this.startNode, s, { points: [] });
        } else if (sources.length === 0) {
            throw new Error('State machine has no sources.');
        } else {
            this.startNode = sources[0];
        }

        if (sinks.length > 1) {
            console.warn(
                'State machine has multiple possible sinks. ' +
                'Using an artificial sink node for layouting.'
            );
            this.endNode = ARTIFICIAL_END;
            this.graph.addNode(this.endNode);
            for (const s of sinks)
                this.graph.addEdge(s, this.endNode, { points: [] });
        } else if (sinks.length === 0) {
            throw new Error('State machine has no sinks.');
        } else {
            this.endNode = sinks[0];
        }

        this.iDoms = immediateDominators(this.graph, this.startNode);
        this.iPostDoms = immediateDominators(inverted, this.endNode);

        [this.allDom, this.domTree] = dominatorTree(
            this.graph, this.startNode, this.iDoms
        );
        [this.allPostDom, this.postDomTree] = dominatorTree(
            this.graph, this.endNode, this.iPostDoms
        );

        [this.backedges, this.eclipsedBackedges] = allBackedges(
            this.graph, this.startNode, true
        );
        this.backedgesCombined = new Set<[string, string]>(this.backedges);
        for (const ebe of this.eclipsedBackedges)
            this.backedgesCombined.add(ebe);

        this.backedgesDstDict = new Map();
        for (const be of this.backedges) {
            if (!this.backedgesDstDict.has(be[1]))
                this.backedgesDstDict.set(be[1], new Set());
            this.backedgesDstDict.get(be[1])!.add(be);
        }
        this.eclipsedBackedgesDstDict = new Map();
        for (const be of this.eclipsedBackedges) {
            if (!this.eclipsedBackedgesDstDict.has(be[1]))
                this.eclipsedBackedgesDstDict.set(be[1], new Set());
            this.eclipsedBackedgesDstDict.get(be[1])!.add(be);
        }

        this.rankDict = new Map();
        this.rankHeights = new Map();
        this.nodeRanks = new Map();
        this.dummyChains = new Set();
    }

    public static layoutDagreCompat(dagreGraph: DagreSDFG): void {
        const g = new DiGraph<SMLayouterNode, SMLayouterEdge>();
        for (const stateId of dagreGraph.nodes())
            g.addNode(stateId, dagreGraph.node(stateId));
        for (const edge of dagreGraph.edges())
            g.addEdge(edge.v, edge.w, dagreGraph.edge(edge));

        SMLayouter.layout(g);
    }

    public doLayout(): void {
        this.doRanking();
        this.normalizeEdges();
        this.permute();
        const routedEdges = this.assignPositions();
        const denormalizedEdges = this.denormalizeEdges();
        for (const edge of denormalizedEdges)
            routedEdges.add(edge);
        this.routeBackEdges(routedEdges);

        this.checkUnroutedEdges(routedEdges);
    }

    private static layout(g: DiGraph<SMLayouterNode, SMLayouterEdge>): void {
        const instance = new SMLayouter(g);
        instance.doLayout();
        if (instance.startNode === ARTIFICIAL_START)
            g.removeNode(ARTIFICIAL_START);
        if (instance.endNode === ARTIFICIAL_END)
            g.removeNode(ARTIFICIAL_END);
    }

    private checkUnroutedEdges(routedEdges: Set<SMLayouterEdge>): void {
        const unrouted = new Set<SMLayouterEdge>();
        for (const edge of this.graph.edgesIter()) {
            const edgeData = this.graph.edge(edge[0], edge[1])!;
            if (!routedEdges.has(edgeData))
                unrouted.add(edgeData);
        }
        if (unrouted.size > 0)
            console.warn(
                'The following edges were not routed:',
                unrouted
            );
    }

    private assignInitialRanks(): void {
        const q: [string, number][] = [[this.startNode, 0]];

        const scopes: [ScopeType, number, number][] = [];
        const visited = new Set<string>();
        const rankings = new Map<string, number>();

        while (q.length > 0) {
            const [node, rank] = q.shift()!;
            if (!visited.has(node)) {
                const backedges = this.backedgesDstDict.get(node) ?? new Set();

                // Assign the rank for the current node (passed along in the
                // queue).
                if (rankings.has(node))
                    rankings.set(node, Math.max(rankings.get(node)!, rank));
                else
                    rankings.set(node, rank);

                // Gather all successors that are not reached through backedges.
                const successors: string[] = [];
                for (const s of this.graph.successorsIter(node)) {
                    let foundAsBackedge = false;
                    for (const sBe of this.backedgesCombined)
                        if (sBe[1] === s && sBe[0] === node) {
                            foundAsBackedge = true;
                            break;
                        }
                    if (!foundAsBackedge)
                        successors.push(s);
                }

                // If the node is a target of one or more backedges, this is
                // potentially either a loop guard or tail.
                if (backedges.size > 0) {
                    // This node is either a loop head or tail, identify the
                    // corresponding other end of the loop and the loop exit.
                    if (backedges.size > 1)
                        throw new Error('Node has multiple backedges.');
                    const otherNode = Array.from(backedges)[0][0];
                    let exitCandidates = new Set<string>();
                    for (const n of successors)
                        if (n !== otherNode && !this.allDom.get(n)?.has(otherNode))
                            exitCandidates.add(n);
                    for (const n of this.graph.successorsIter(otherNode))
                        if (n !== node)
                            exitCandidates.add(n);

                    if (exitCandidates.size < 1) {
                        throw new Error('No exit candidates found.');
                    } else if (exitCandidates.size > 1) {
                        // Find the exit candidate that sits highest up in the
                        // postdominator tree (i.e., has the lowest level).
                        // That must be the exit node (it must post-dominate)
                        // everything inside the loop. If there are multiple
                        // candidates on the lowest level (i.e., disjoint set of
                        // postdominated nodes), there are multiple exit paths,
                        // and they all share one level.
                        let minLevel = Infinity;
                        const minSet = new Set<string>();

                        for (const s of exitCandidates) {
                            const postDom = this.postDomTree.get(s);
                            const level = postDom?.level ?? Infinity;
                            if (level < minLevel) {
                                minLevel = level;
                                minSet.clear();
                                minSet.add(s);
                            } else if (level === minLevel) {
                                minSet.add(s);
                            }
                        }

                        if (minSet.size > 0)
                            exitCandidates = minSet;
                        else
                            throw new Error('Failed to determine exit.');
                    }

                    // TODO: Not sure about this, this may fail in situations
                    // where the loop is executed conditionally and contains
                    // breaks and returns. Double check.
                    let subtr = 0;
                    for (const s of exitCandidates)
                        subtr += this.allDom.get(s)?.size ?? 0;
                    const exitRank = rank + (
                        (this.allDom.get(node)?.size ?? 0) - subtr
                    );
                    for (const s of exitCandidates)
                        q.push([s, exitRank]);

                    // Add all successors that are not the exit candidate.
                    for (const n of successors)
                        if (!exitCandidates.has(n))
                            q.push([n, rank + 1]);
                } else if (successors.length === 1) {
                    // Cases with only one successor are trivial, continue and
                    // assign the next higher rank.
                    q.push([successors[0], rank + 1]);
                } else if (successors.length > 1) {
                    // This is a conditional split. Locate the merge state
                    // (if present) and move it down n ranks, where n is the
                    // number of nodes in the branch scope. n can be obtained by
                    // taking the difference between the number of nodes
                    // dominated by the entry, versus the number of nodes
                    // dominated by the exit.
                    let mergeNode = undefined;
                    const iPostDom = this.iPostDoms.get(node);
                    if (iPostDom && successors.includes(iPostDom)) {
                        mergeNode = iPostDom;
                    } else {
                        for (const s of this.domTree.successorsIter(node)) {
                            if (!successors.includes(s)) {
                                mergeNode = s;
                                break;
                            }
                        }
                    }

                    if (mergeNode) {
                        const mergeNodeRank = rank + (
                            (this.allDom.get(node)?.size ?? 0) -
                            (this.allDom.get(mergeNode)?.size ?? 0)
                        );
                        q.push([mergeNode, mergeNodeRank]);
                        scopes.push([ScopeType.BRANCH, rank, mergeNodeRank]);
                    }

                    for (const s of successors)
                        if (s !== mergeNode)
                            q.push([s, rank + 1]);
                }

                visited.add(node);
            }
        }

        this.rankDict.clear();
        this.rankHeights.clear();
        this.nodeRanks.clear();
        for (const k of rankings.keys()) {
            const v = rankings.get(k)!;
            if (!this.rankDict.has(v))
                this.rankDict.set(v, []);
            this.rankDict.get(v)!.push(k);
            this.nodeRanks.set(k, v);
        }
    }

    private contractRanks(): void {
        const origRanks = Array.from(this.rankDict.keys()).sort((a, b) => {
            return a - b;
        });
        const contractedRanks = new Map<number, string[]>();
        const contractedRankHeights = new Map<number, number>();
        let i = 0;
        for (const r of origRanks) {
            contractedRanks.set(i, this.rankDict.get(r)!);
            contractedRankHeights.set(i, this.rankHeights.get(r) ?? 0);
            i++;
        }
        this.rankDict.clear();
        this.rankHeights.clear();
        this.nodeRanks.clear();
        for (const k of contractedRanks.keys()) {
            this.rankDict.set(k, contractedRanks.get(k)!);
            this.rankHeights.set(k, contractedRankHeights.get(k)!);
            for (const v of contractedRanks.get(k)!)
                this.nodeRanks.set(v, k);
        }
    }

    private doRanking(): void {
        this.assignInitialRanks();
        this.contractRanks();
    }

    private normalizeEdges(): void {
        let nDummyNode = 0;
        for (const edge of this.graph.edgesIter()) {
            const src = edge[0];
            const dst = edge[1];
            const srcRank = this.nodeRanks.get(src)!;
            const dstRank = this.nodeRanks.get(dst)!;

            // If the edge spans only one rank, nothing needs to be done.
            if (srcRank === dstRank - 1)
                continue;

            // We also don't want to handle back edges here.
            if (srcRank > dstRank)
                continue;

            // If the edge spans more than one rank, insert dummy nodes and
            // edges to normalize the edge.
            let eSrc = src;
            let eDst = null;
            const dummyChain: string[] = [];
            const origEdge = this.graph.edge(src, dst)!;
            for (let i = srcRank + 1; i < dstRank; i++) {
                const dummyNode = `__smlayouter_dummy_${nDummyNode}`;
                eDst = dummyNode;
                nDummyNode++;
                this.graph.addNode(dummyNode, {
                    width: 0,
                    height: 0,
                    x: 0,
                    y: 0,
                });
                dummyChain.push(dummyNode);
                this.nodeRanks.set(dummyNode, i);
                if (!this.rankDict.has(i))
                    this.rankDict.set(i, []);
                this.rankDict.get(i)!.push(dummyNode);
                this.graph.addEdge(eSrc, eDst, { points: [] });
                eSrc = dummyNode;
            }
            eDst = dst;
            this.graph.addEdge(eSrc, eDst, { points: [] });
            this.dummyChains.add([origEdge, dummyChain]);
            this.graph.removeEdge(src, dst);
        }
    }

    private denormalizeEdges(): Set<SMLayouterEdge> {
        const routedEdges = new Set<SMLayouterEdge>();

        for (const [oEdge, dummyChain] of this.dummyChains) {
            if (dummyChain.length < 1)
                continue;

            let chainSrc = null;
            let chainDst = null;
            const points = [];
            for (const dummyNode of dummyChain) {
                const rank = this.nodeRanks.get(dummyNode)!;
                this.rankDict.set(rank, this.rankDict.get(rank)!.filter(
                    (v) => v !== dummyNode
                ));
                this.nodeRanks.delete(dummyNode);
                const pred = this.graph.predecessors(dummyNode)[0];
                if (chainSrc === null)
                    chainSrc = pred;
                const succ = this.graph.successors(dummyNode)[0];
                chainDst = succ;
                const node = this.graph.get(dummyNode)!;
                const rankHeight = this.rankHeights.get(rank) ?? 0;
                if (rankHeight > 0) {
                    points.push({ x: node.x, y: node.y - (rankHeight / 2) });
                    points.push({ x: node.x, y: node.y + (rankHeight / 2) });
                } else {
                    points.push({ x: node.x, y: node.y });
                }
            }

            const sn = this.graph.get(chainSrc!)!;
            const dn = this.graph.get(chainDst!)!;
            oEdge.points = [
                { x: sn.x, y: sn.y + (sn.height / 2) },
                ...points,
                { x: dn.x, y: dn.y - (dn.height / 2) },
            ];
            this.graph.addEdge(chainSrc!, chainDst!, oEdge);

            for (const dummyNode of dummyChain)
                this.graph.removeNode(dummyNode);

            routedEdges.add(oEdge);
        }
        this.dummyChains.clear();

        return routedEdges;
    }

    private routeBackEdges(routedEdges: Set<SMLayouterEdge>): void {
        // Create a set of back-edge 'lanes' on the very left of the layout
        // where all back-edges are routed upwards.

        const backedges: {
            distance: number,
            srcRank: number,
            dstRank: number,
            edge: [string, string],
        }[] = [];
        for (const be of this.backedgesCombined) {
            const edgeData = this.graph.edge(be[0], be[1])!;
            if (routedEdges.has(edgeData))
                continue;

            const dstRank = this.nodeRanks.get(be[1])!;
            const srcRank = this.nodeRanks.get(be[0])!;
            const distance = Math.abs(dstRank - srcRank);
            backedges.push({
                distance: distance,
                srcRank: srcRank,
                dstRank: dstRank,
                edge: be,
            });
        }

        // Sort backedges by increasing destination (i.e. 'upper' rank).
        backedges.sort((a, b) => {
            return a.dstRank - b.dstRank;
        });

        const lanes: {
            minRank: number,
            maxRank: number,
            edges: [string, string][],
        }[] = [];
        for (const be of backedges) {
            if (lanes.length === 0) {
                lanes.push({
                    minRank: be.dstRank,
                    maxRank: be.srcRank,
                    edges: [be.edge],
                });
            } else {
                let foundLane = false;
                for (const lane of lanes) {
                    const low = Math.max(be.dstRank, lane.minRank);
                    const high = Math.min(be.srcRank, lane.maxRank);
                    if (low > high) {
                        lane.edges.push(be.edge);
                        lane.minRank = Math.min(be.dstRank, lane.minRank);
                        lane.maxRank = Math.max(be.srcRank, lane.maxRank);
                        foundLane = true;
                        break;
                    }
                }

                if (!foundLane) {
                    lanes.push({
                        minRank: be.dstRank,
                        maxRank: be.srcRank,
                        edges: [be.edge],
                    });
                }
            }
        }

        let i = 0;
        for (const lane of lanes) {
            i++;
            for (const edge of lane.edges) {
                const edgeData = this.graph.edge(edge[0], edge[1])!;
                const src = this.graph.get(edge[0])!;
                const dst = this.graph.get(edge[1])!;
                const baseX = src.x - (src.width / 2);
                const offset = i * NODE_SPACING;
                edgeData.points = [
                    { x: baseX, y: src.y },
                    { x: baseX - offset, y: src.y },
                    { x: baseX - offset, y: dst.y },
                    { x: baseX, y: dst.y },
                ];
                routedEdges.add(edgeData);
            }
        }
    }

    private permute(): void {
        // TODO: replace this so we do not need to use dagre for this.
        const dagreGraph = new dagre.graphlib.Graph({
            directed: true,
            multigraph: false,
            compound: false,
        });
        for (const node of this.graph.nodesIter()) {
            const rank = this.nodeRanks.get(node)!;
            dagreGraph.setNode(node, { rank: rank });
        }
        for (const edge of this.graph.edgesIter()) {
            const src = edge[0];
            const dst = edge[1];
            dagreGraph.setEdge(src, dst, { weight: 0 });
        }

        dagreOrder(dagreGraph);

        dagreGraph.nodes().forEach((node) => {
            this.graph.get(node)!.order = (dagreGraph.node(node) as any).order;
        });

        // Sort based on the order assigned by dagre.
        for (const rank of this.rankDict.keys()) {
            const nodes = this.rankDict.get(rank)!;
            nodes.sort((a, b) => {
                const aOrder = this.graph.get(a)?.order;
                const bOrder = this.graph.get(b)?.order;
                if (aOrder === undefined || bOrder === undefined)
                    return 0;
                return aOrder - bOrder;
            });
            this.rankDict.set(rank, nodes);
        }
    }

    private assignPositions(): Set<SMLayouterEdge> {
        const routedEdges = new Set<SMLayouterEdge>();

        let lastY = 0;
        let lastHeight = 0;
        const sortedRanks = Array.from(this.rankDict.keys()).sort((a, b) => {
            return a - b;
        });
        for (const rank of sortedRanks) {
            const rankNodes = this.rankDict.get(rank)!;
            let thisHeight = 0;
            for (const nodeId of rankNodes) {
                const node = this.graph.get(nodeId)!;
                thisHeight = Math.max(thisHeight, node.height);
            }
            this.rankHeights.set(rank, thisHeight);

            const thisY = (
                lastY + (lastHeight / 2) + LAYER_SPACING + (thisHeight / 2)
            );
            lastY = thisY;
            lastHeight = thisHeight;

            let lastX = 0;
            let lastWidth = 0;
            for (const nodeId of rankNodes) {
                const node = this.graph.get(nodeId)!;
                const thisX = (
                    lastX + (lastWidth / 2) + NODE_SPACING + (node.width / 2)
                );
                lastX = thisX;
                lastWidth = node.width;
                node.x = thisX;
                node.y = thisY;
            }
        }

        for (const edge of this.graph.edgesIter()) {
            // Here we don't want to route backedges, they are handled
            // separately.
            const srcRank = this.nodeRanks.get(edge[0])!;
            const dstRank = this.nodeRanks.get(edge[1])!;
            if (srcRank > dstRank)
                continue;

            const edgeData = this.graph.edge(edge[0], edge[1])!;
            const src = this.graph.get(edge[0])!;
            const dst = this.graph.get(edge[1])!;
            edgeData.points = [
                { x: src.x, y: src.y + (src.height / 2) },
                { x: dst.x, y: dst.y - (dst.height / 2) },
            ];
            routedEdges.add(edgeData);
        }

        return routedEdges;
    }

}
