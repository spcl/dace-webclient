// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { allBackedges } from '../graphlib/algorithms/cycles';
import {
    dominatorTree,
    immediateDominators,
} from '../graphlib/algorithms/dominance';
import { DiGraph } from '../graphlib/di_graph';
import type {
    DagreGraph,
    SDFGRenderer,
} from '../../renderer/sdfg/sdfg_renderer';
import { SMLayouterOrdering } from './ordering';
import {
    DummyInterstateEdge,
    DummyState,
} from '../../renderer/sdfg/sdfg_elements';


const ARTIFICIAL_START = '__smlayouter_artifical_start';
const ARTIFICIAL_END = '__smlayouter_artifical_end';
export const DUMMY_PREFIX = '__dummy';

export const LAYER_SPACING = 50;
export const NODE_SPACING = 50;
export const EDGE_WIDTH = 1;
export const EDGE_SPACING = 20;
export const BACKEDGE_SPACING = EDGE_SPACING;
export const SKIP_EDGES_CENTER_OFFSET = 50; // Given in percent.

enum ScopeType {
    BRANCH,
    LOOP_REGULAR,
    LOOP_INVERTED,
}

interface IBackedge {
    distance: number;
    srcRank: number;
    dstRank: number;
    edge: [string, string];
    children: IBackedge[];
    depth?: number;
    root?: IBackedge;
    maxDepth?: number;
}

interface IBackedgeEvent {
    rank: number;
    type: 'src' | 'dst';
    edge: IBackedge;
}

export interface SMLayouterNode {
    width: number;
    height: number;
    x: number;
    y: number;
    order?: number;
    rank?: number;
    minLane?: number;
    lane?: number;
}

export interface SMLayouterEdge {
    x?: number,
    y?: number,
    width?: number,
    height?: number,
    points: { x: number, y: number }[];
    src?: string;
    dst?: string;
    weight?: number;
    wasBackedge?: boolean;
}

export class SMLayouter {

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
    private readonly removedBackedges: Map<string, SMLayouterEdge | null>;
    public readonly rankDict: Map<number, string[]>;
    private readonly rankHeights: Map<number, number>;
    private readonly dummyChains: Map<string, [SMLayouterEdge, string[]]>;

    private readonly orderer: SMLayouterOrdering;

    public constructor(
        public readonly graph: DiGraph<SMLayouterNode, SMLayouterEdge>,
        private readonly renderer?: SDFGRenderer,
        startState?: string,
        private readonly dagreGraph?: DagreGraph,
        private readonly debug: boolean = false
    ) {
        this.rankDict = new Map();
        this.rankHeights = new Map();
        this.dummyChains = new Map();

        // --------------------------------------------------
        // - Preparation phase for state machine layouting. -
        // --------------------------------------------------
        // This phase constructs the following helper data structures:
        //  * Inverted graph for post-dominator analysis.
        //  * Dictionaries for immediate dominators and post-dominators.
        //  * Complete dominator and post-dominator trees.
        //  * Dictionaries mapping each node to all nodes dominated and post-
        //    dominated by it.
        //  * Collection of all back-edges, including back-edges eclipsed by
        //    other back-edges in a separate collection.
        //  * Dictionaries mapping destination nodes of back-edges to the
        //    corresponding back-edges, to speed up lookups / searches.
        const sources = this.graph.sources();
        const sinks = this.graph.sinks();

        if (sources.length > 1) {
            console.warn(
                'State machine has multiple possible sources. ' +
                'Using an artificial source node for layouting.'
            );
            this.startNode = ARTIFICIAL_START;
            this.graph.addNode(this.startNode, {
                x: 0,
                y: 0,
                width: 0,
                height: 0,
                order: undefined,
            });
            for (const s of sources)
                this.graph.addEdge(this.startNode, s, { points: [] });
        } else if (sources.length === 0) {
            if (startState === undefined)
                throw new Error('State machine has no sources.');
            else
                this.startNode = startState;
        } else {
            this.startNode = sources[0];
        }

        if (sinks.length > 1) {
            console.warn(
                'State machine has multiple possible sinks. ' +
                'Using an artificial sink node for layouting.'
            );
            this.endNode = ARTIFICIAL_END;
            this.graph.addNode(this.endNode, {
                x: 0,
                y: 0,
                width: 0,
                height: 0,
                order: undefined,
            });
            for (const s of sinks)
                this.graph.addEdge(s, this.endNode, { points: [] });
        } else if (sinks.length === 0) {
            throw new Error('State machine has no sinks.');
        } else {
            this.endNode = sinks[0];
        }

        const inverted = this.graph.reversed();

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
        this.removedBackedges = new Map();

        this.orderer = new SMLayouterOrdering(this);
    }

    /**
     * Perform state machine layout for an existing dagre.js layout graph.
     * This translates the dagre graph into a minimal DiGraph necessary for
     * performing the layout.
     * @param {DagreGraph} dagreGraph Dagre.js graph to perform layouting for.
     */
    public static layoutDagreCompat(
        dagreGraph: DagreGraph, renderer: SDFGRenderer, startState?: string
    ): number {
        const g = new DiGraph<SMLayouterNode, SMLayouterEdge>();
        for (const stateId of dagreGraph.nodes())
            g.addNode(stateId, dagreGraph.node(stateId));
        for (const edge of dagreGraph.edges())
            g.addEdge(edge.v, edge.w, dagreGraph.edge(edge));

        return SMLayouter.layout(g, renderer, startState, dagreGraph);
    }

    /**
     * Lay out a graph after the necessary preparation phase has been run.
     * The preparation phase is run when the layouter object is constructed.
     * The layout procedure runs in 6 distinct phases:
     *   1. Perform node ranking:
     *      Each node is assigned to a rank which corresponds to the vertical
     *      level it sits on. This ensures the vertical layout constraints.
     *   2. Normalize edges:
     *      Each edge spanning more than one vertical rank is split into N parts
     *      with dummy nodes between each part, where N is the number of ranks
     *      spanned.
     *   3. Perform in-rank permutations:
     *      Permute nodes on the same rank such that the number of edge
     *      crossings is minimized.
     *   4. Assign coordinates:
     *      Use the rankings and in-rank positions to assign concrete
     *      coordinates for each node and edge.
     *   5. De-normalize edges:
     *      Merge any previously normalized (i.e., split) edge back together
     *      into one edge spanning multiple ranks.
     *   6. Route back-edges:
     *      Add a 'lane' to the left of the laid out graph where all back-edges
     *      are routed upwards in the vertical layout. Ensures that the number
     *      of crossings is reduced to a minimum.
     *
     * Note: This operates in-place on the layout graph.
     * @see {@link SMLayouter.doRanking}
     * @see {@link SMLayouter.normalizeEdges}
     */
    public doLayout(): void {
        this.doRanking();
        this.makeAcyclic();
        this.normalizeEdges();
        this.permute();
        //this.permute();
        this.undoMakeAcyclic();
        const routedEdges = this.assignPositions();
        const denormalizedEdges = this.denormalizeEdges();
        for (const edge of denormalizedEdges)
            routedEdges.add(edge);
        this.routeBackEdges(routedEdges);

        //this.checkUnroutedEdges(routedEdges);
    }

    /**
     * Lay out a DiGraph.
     * @param {DiGraph<SMLayouterNode, SMLayouterEdge>} g Graph to lay out.
     */
    private static layout(
        g: DiGraph<SMLayouterNode, SMLayouterEdge>,
        renderer: SDFGRenderer,
        startState?: string,
        dagreGraph?: DagreGraph
    ): number {
        // Construct a layouter instance (runs preparation phase) and perform
        // the laying out. Clean up afterwards by removing dummy start and end
        // nodes if they were added.
        const startTime = performance.now();
        const instance = new SMLayouter(g, renderer, startState, dagreGraph);
        instance.doLayout();
        if (instance.startNode === ARTIFICIAL_START)
            g.removeNode(ARTIFICIAL_START);
        if (instance.endNode === ARTIFICIAL_END)
            g.removeNode(ARTIFICIAL_END);
        const endTime = performance.now();
        return endTime - startTime;
    }

    /**
     * Perform a sanity check to ensure all edges have been routed.
     * Warn if some edges have not been routed.
     * @param {Set<SMLayouterEdge>} routedEdges Set of already routed edges.
     */
    private checkUnroutedEdges(routedEdges: Set<SMLayouterEdge>): void {
        const unrouted = new Set<SMLayouterEdge>();
        for (const edge of this.graph.edgesIter()) {
            const edgeData = this.graph.edge(edge[0], edge[1])!;
            if (!routedEdges.has(edgeData))
                unrouted.add(edgeData);
        }
        if (unrouted.size > 0) {
            console.warn(
                'The following edges were not routed:',
                unrouted
            );
            // To avoid crashing, simply straight-route these edges.
            for (const edge of unrouted) {
                if (edge.src === undefined || edge.dst === undefined)
                    throw Error('Unrouted edge has no source or target.');
                const srcNode = this.graph.get(edge.src);
                const dstNode = this.graph.get(edge.dst);
                if (!srcNode || !dstNode)
                    throw Error('Unrouted edge may not be straight-routed.');
                edge.points = [
                    {
                        x: srcNode.x,
                        y: srcNode.y + (srcNode.height / 2),
                    },
                    {
                        x: dstNode.x,
                        y: dstNode.y - (dstNode.height / 2),
                    },
                ];
            }
        }
    }

    private propagate(
        node: string, successors: string[], rank: number, q: [string, number][],
        scopes: [ScopeType, number, number][]
    ): void {
        if (successors.length === 1) {
            // Cases with only one successor are trivial, continue and
            // assign the next higher rank.
            q.push([successors[0], rank + 1]);
        } else if (successors.length > 1) {
            // This is a conditional split.
            // Locate the merge state (if present) and move it down n ranks,
            // where n is the number of nodes in the branch scope. n can be
            // obtained by taking the difference between the number of nodes
            // dominated by the entry, versus the number of nodes dominated by
            // the exit.
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

            for (const s of successors) {
                if (s !== mergeNode)
                    q.push([s, rank + 1]);
            }
        }
    }

    private reserveLoopSpace(
        node: string, successors: string[], rank: number, q: [string, number][],
        oNode: string
    ): void {
        let exitCandidates = new Set<string>();
        for (const n of successors) {
            if (n !== oNode && !this.allDom.get(n)?.has(oNode))
                exitCandidates.add(n);
        }
        for (const n of this.graph.successorsIter(oNode)) {
            if (n !== node)
                exitCandidates.add(n);
        }

        if (exitCandidates.size < 1) {
            throw new Error('No exit candidates found.');
        } else if (exitCandidates.size > 1) {
            // Find the exit candidate that sits highest up in the postdominator
            // tree (i.e., has the lowest level). That must be the exit node (it
            // must post-dominate) everything inside the loop. If there are
            // multiple candidates on the lowest level (i.e., disjoint set of
            // postdominated nodes), there are multiple exit paths, and they all
            // share one level.
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
                exitCandidates = new Set([...minSet]);
            else
                throw new Error('Failed to determine exit.');
        }

        if (exitCandidates.size >= 1) {
            let loopSize = 0;
            for (const s of successors) {
                if (!exitCandidates.has(s)) {
                    loopSize += (this.allDom.get(s)?.size ?? 0) + 1;
                    q.push([s, rank + 1]);
                }
            }
            const exitRank = rank + loopSize + 1;
            for (const s of exitCandidates)
                q.push([s, exitRank]);
        } else {
            // Add all successors that are not the exit candidate.
            for (const n of successors)
                q.push([n, rank + 1]);
        }
    }

    /**
     * Assign all layout nodes to initial layout ranks.
     * This may leave certain ranks empty to conservatively ensure vertical
     * layout constraints are met.
     */
    private assignInitialRanks(): void {
        const q: [string, number][] = [[this.startNode, 0]];

        const scopes: [ScopeType, number, number][] = [];
        const rankings = new Map<string, number>();

        while (q.length > 0) {
            const [node, rank] = q.shift()!;
            if (rankings.has(node)) {
                rankings.set(node, Math.max(rankings.get(node)!, rank));
            } else {
                rankings.set(node, rank);

                const backedges = this.backedgesDstDict.get(node) ?? new Set();

                // Gather all successors that are not reached through backedges.
                const successors: string[] = [];
                for (const s of this.graph.successorsIter(node)) {
                    let foundAsBackedge = false;
                    for (const sBe of this.backedgesCombined) {
                        if (sBe[1] === s && sBe[0] === node) {
                            foundAsBackedge = true;
                            break;
                        }
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
                    const oNode = Array.from(backedges)[0][0];

                    // If all successors of the current node are post-dominated
                    // by the source node of the backedge, this is an inverted
                    // loop.
                    let inverted = true;
                    for (const n of successors) {
                        if (n !== oNode && !this.allPostDom.get(oNode)?.has(n))
                            inverted = false;
                    }

                    // If the loop is inverted, we do not need to reserve space
                    // and can just propagate normally. Otherwise, reserve space
                    // for the loop body and move the exit node down
                    // accordingly.
                    if (inverted)
                        this.propagate(node, successors, rank, q, scopes);
                    else
                        this.reserveLoopSpace(node, successors, rank, q, oNode);
                } else {
                    this.propagate(node, successors, rank, q, scopes);
                }
            }
        }

        this.rankDict.clear();
        this.rankHeights.clear();
        for (const k of rankings.keys()) {
            const v = rankings.get(k)!;
            if (!this.rankDict.has(v))
                this.rankDict.set(v, []);
            this.rankDict.get(v)!.push(k);
            this.graph.get(k)!.rank = v;
        }
    }

    /**
     * Contract the vertical ranking to ensure no ranks are left empty.
     */
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
        for (const k of contractedRanks.keys()) {
            this.rankDict.set(k, contractedRanks.get(k)!);
            this.rankHeights.set(k, contractedRankHeights.get(k)!);
            for (const v of contractedRanks.get(k)!)
                this.graph.get(v)!.rank = k;
        }
    }

    /**
     * Assign each node to a vertical rank.
     * The vertical ranking is performed according to a set of constraints that
     * help to enforce a happens-before relationship in flowgraphs:
     *   1. What dominates must appear before (i.e., higher up and consequently
     *      on a rank above).
     *   2. What post-dominates must appear below (i.e., lower down, on ranks
     *      below).
     *   3. Ranks are only shared if no concrete happens-before relationship
     *      can be constructed. In a flowgraph, this implies something happening
     *      concurrently or an either-or relationship, such as with branching in
     *      control-flow).
     */
    private doRanking(): void {
        // Assign initial ranks, which may result in certain ranks being empty.
        this.assignInitialRanks();
        // Remove any empty ranks through contracting the ranking.
        this.contractRanks();
    }

    /**
     * Perform edge normalization by splitting up edges spanning multiple ranks.
     * Edges spanning N > 1 ranks are split into N sub-edges with dummy nodes
     * between them.
     */
    private normalizeEdges(): void {
        let nDummyNode = 0;
        for (const edge of this.graph.edgesIter()) {
            const src = edge[0];
            const dst = edge[1];
            const edgeData = this.graph.edge(src, dst);

            // Self-edges do not need to be normalized.
            if (src === dst)
                continue;

            const srcRank = this.graph.get(src)!.rank!;
            const dstRank = this.graph.get(dst)!.rank!;

            // If the edge spans only one rank or is within the same rank,
            // nothing needs to be done.
            if (srcRank === dstRank - 1 || srcRank === dstRank)
                continue;

            // We also don't want to handle back edges here.
            if (srcRank > dstRank)
                continue;

            // Debugging aid.
            const isBackedge = edgeData?.wasBackedge ?? false;

            // If the edge spans more than one rank, insert dummy nodes and
            // edges to normalize the edge.
            let eSrc = src;
            let eDst = null;
            const dummyChain: string[] = [];
            const origEdge = this.graph.edge(src, dst)!;
            for (let i = srcRank + 1; i < dstRank; i++) {
                const dummyNode = `${DUMMY_PREFIX}_${nDummyNode.toString()}`;
                eDst = dummyNode;
                nDummyNode++;
                const dummyNodeData = this.renderer ? new DummyState(
                    this.renderer, this.renderer.ctx, this.renderer.minimapCtx,
                    { state: { label: dummyNode } }, nDummyNode
                ) as SMLayouterNode : {
                    x: 0, y: 0, width: 0, height: 0, rank: undefined,
                };
                if (isBackedge)
                    (dummyNodeData as DummyState).forBackChain = true;
                dummyNodeData.width = 50;
                dummyNodeData.height = 50;
                dummyNodeData.rank = i;
                this.graph.addNode(dummyNode, dummyNodeData);

                if (this.debug && this.renderer) {
                    this.dagreGraph?.setNode(dummyNode, dummyNodeData);
                    const rendererEdge = new DummyInterstateEdge(
                        this.renderer, this.renderer.ctx,
                        this.renderer.minimapCtx, undefined, 0
                    );
                    if (isBackedge)
                        rendererEdge.forBackChain = true;
                    this.dagreGraph?.setEdge(eSrc, eDst, rendererEdge);
                }
                dummyChain.push(dummyNode);
                if (!this.rankDict.has(i))
                    this.rankDict.set(i, []);
                this.rankDict.get(i)!.push(dummyNode);
                this.graph.addEdge(
                    eSrc, eDst, { points: [], wasBackedge: isBackedge }
                );
                eSrc = dummyNode;
            }
            eDst = dst;
            this.graph.addEdge(
                eSrc, eDst, { points: [], wasBackedge: isBackedge }
            );
            if (this.debug && this.renderer) {
                const rendererEdge = new DummyInterstateEdge(
                    this.renderer, this.renderer.ctx,
                    this.renderer.minimapCtx, undefined, 0
                );
                if (isBackedge)
                    rendererEdge.forBackChain = true;
                this.dagreGraph?.setEdge(eSrc, eDst, rendererEdge);
            }
            const chainIdent = src + '->' + dst;
            this.dummyChains.set(chainIdent, [origEdge, dummyChain]);
            this.graph.removeEdge(src, dst);
        }
    }

    /**
     * De-normalize any previously noramlized edge paths.
     * This merges normalized edge paths back together into a singular edge.
     * @returns {Set<SMLayouterEdge>} Set of routed edges after this step.
     */
    private denormalizeEdges(): Set<SMLayouterEdge> {
        const routedEdges = new Set<SMLayouterEdge>();
        const skipEdges = new Set<SMLayouterEdge>();

        const handled = new Set<string>();
        for (const chain of this.dummyChains.keys()) {
            const [oEdge, dummyChain] = this.dummyChains.get(chain)!;
            if (dummyChain.length < 1)
                continue;
            if (oEdge.wasBackedge)
                continue;
            handled.add(chain);

            let chainSrc = undefined;
            let chainDst = undefined;
            const points = [];
            for (const dummyNode of dummyChain) {
                const rank = this.graph.get(dummyNode)!.rank!;
                this.rankDict.set(rank, this.rankDict.get(rank)!.filter(
                    (v) => v !== dummyNode
                ));
                const pred = this.graph.predecessors(dummyNode)[0];
                chainSrc ??= pred;
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

            if (chainSrc === undefined || chainDst === undefined)
                throw new Error('Failed to determine chain source or target.');

            const sn = this.graph.get(chainSrc)!;
            const dn = this.graph.get(chainDst)!;
            const sourceX = sn.x + (sn.width / 200) * SKIP_EDGES_CENTER_OFFSET;
            const firstPoint = points[0];
            const lastPoint = points[points.length - 1];
            const nPoints = [];
            if (firstPoint.x !== sourceX) {
                const firstY = sn.y + (sn.height / 2);
                const midY = firstY + (NODE_SPACING / 2);
                nPoints.push({ x: sourceX, y: firstY });
                nPoints.push({ x: sourceX, y: midY });
                nPoints.push({ x: firstPoint.x, y: midY });
            } else {
                nPoints.push({ x: sourceX, y: sn.y + (sn.height / 2) });
            }
            nPoints.push(...points);
            if (lastPoint.x !== dn.x) {
                const lastY = dn.y - (dn.height / 2);
                const midY = lastY - (NODE_SPACING / 2);
                nPoints.push({ x: lastPoint.x, y: midY });
                nPoints.push({ x: dn.x, y: midY });
                nPoints.push({ x: dn.x, y: lastY });
            } else {
                nPoints.push({ x: dn.x, y: dn.y - (dn.height / 2) });
            }
            oEdge.points = nPoints;
            this.graph.addEdge(chainSrc, chainDst, oEdge);

            for (const dummyNode of dummyChain) {
                this.graph.removeNode(dummyNode);
                if (this.debug)
                    this.dagreGraph?.removeNode(dummyNode);
            }

            skipEdges.add(oEdge);
        }
        //this.dummyChains.clear();

        // Straighten all skip edges out.
        for (const edge of skipEdges) {
            const points = edge.points;
            if (points.length <= 2)
                continue;

            let maxX = 0;
            for (let i = 1; i < points.length - 1; i++)
                maxX = Math.max(maxX, points[i].x);
            for (let i = 1; i < points.length - 1; i++)
                points[i].x = maxX;

            routedEdges.add(edge);
        }

        return routedEdges;
    }

    /**
     * Route back-edges upwards in a separate lane to the left of the graph.
     * @param {Set<SMLayouterEdge>} routedEdges Set of routed edges after this
     *                                          step.
     */
    private routeBackEdgesOld(routedEdges: Set<SMLayouterEdge>): void {
        // -------------------------------------------
        // Determine the scopes for backedges.
        // -------------------------------------------
        const backedgeEvents: IBackedgeEvent[] = [];
        for (const be of this.backedgesCombined) {
            const ident = be[0] + '->' + be[1];
            const edgeData = this.removedBackedges.get(ident)!;
            if (routedEdges.has(edgeData))
                continue;

            const dstRank = this.graph.get(be[1])!.rank!;
            const srcRank = this.graph.get(be[0])!.rank!;
            const distance = Math.abs(dstRank - srcRank);
            const backedge: IBackedge = {
                distance: distance,
                srcRank: srcRank,
                dstRank: dstRank,
                edge: be,
                children: [],
                depth: 0,
                maxDepth: 0,
            };
            backedgeEvents.push({
                rank: dstRank,
                type: 'dst',
                edge: backedge,
            });
            backedgeEvents.push({
                rank: srcRank,
                type: 'src',
                edge: backedge,
            });
        }
        backedgeEvents.sort((a, b) => {
            return a.rank - b.rank;
        });

        let maxDepth = 0;
        const openBackedges: IBackedge[] = [];
        const handledBackedges = new Set<IBackedge>();
        const topLevelBackedges = new Set<IBackedge>();
        for (const event of backedgeEvents) {
            if (event.type === 'dst') {
                // This is the 'upper' end of the backedge.
                if (openBackedges.length === 0) {
                    // No other backedge is currently open.
                    openBackedges.push(event.edge);
                } else {
                    const lastOpenBE = openBackedges[openBackedges.length - 1];
                    if (lastOpenBE.srcRank >= event.edge.srcRank) {
                        // The currently open backedge fully encapsulates the
                        // new backedge. We can add it as a child.
                        lastOpenBE.children.push(event.edge);
                        event.edge.root = lastOpenBE.root ?? lastOpenBE;

                        event.edge.depth = lastOpenBE.depth! + 1;
                        maxDepth = Math.max(maxDepth, event.edge.depth);
                        event.edge.root.maxDepth = Math.max(
                            event.edge.root.maxDepth ?? 0, event.edge.depth
                        );

                        handledBackedges.add(event.edge);
                        openBackedges.push(event.edge);
                    } else {
                        openBackedges.pop();
                        openBackedges.push(event.edge);
                        handledBackedges.add(lastOpenBE);
                        topLevelBackedges.add(lastOpenBE);
                    }
                }
            } else {
                // This is the 'lower' end of a backedge.

                // If this backedge is the last opened backedge, it must be
                // removed from the stack.
                if (openBackedges.length > 0) {
                    const lastOpenBE = openBackedges[openBackedges.length - 1];
                    if (lastOpenBE === event.edge)
                        openBackedges.pop();
                }

                if (!handledBackedges.has(event.edge))
                    topLevelBackedges.add(event.edge);
            }
        }

        // -------------------------------------------
        // Assign each backedge to the lane it belongs to.
        // -------------------------------------------

        // Construct the necessary number of lanes.
        const lanes = new Map<number, IBackedge[]>();
        for (let i = 0; i < maxDepth + 1; i++)
            lanes.set(i, []);

        const recursiveFlipDepths = (be: IBackedge, maxD: number) => {
            be.depth = maxD - be.depth!;
            for (const child of be.children)
                recursiveFlipDepths(child, maxD);
        };
        for (const be of topLevelBackedges)
            recursiveFlipDepths(be, be.maxDepth ?? 0);

        const recursiveAssignLanes = (be: IBackedge) => {
            const lvl = maxDepth - be.depth!;
            lanes.get(lvl >= 0 ? lvl : 0)!.push(be);
            for (const child of be.children)
                recursiveAssignLanes(child);
        };
        for (const be of topLevelBackedges)
            recursiveAssignLanes(be);

        // -------------------------------------------
        // Bubble up through the lanes based on conflicts.
        // -------------------------------------------
        // TODO: implement.

        // -------------------------------------------
        // Route the backedges based on their lane.
        // -------------------------------------------
        for (let i = maxDepth; i >= 0; i--) {
            const lane = lanes.get(i)!;
            const laneNr = (maxDepth - i) + 1;
            for (const be of lane) {
                const ident = be.edge[0] + '->' + be.edge[1];
                const edgeData = this.removedBackedges.get(ident)!;
                const src = this.graph.get(be.edge[0])!;
                const dst = this.graph.get(be.edge[1])!;
                const baseX = src.x - (src.width / 2);
                const offset = laneNr * BACKEDGE_SPACING;
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

    private routeBackEdges(routedEdges: Set<SMLayouterEdge>): void {
        for (const be of this.backedgesCombined) {
            const ident = be[0] + '->' + be[1];
            const oedge = this.removedBackedges.get(ident)!;
            if (routedEdges.has(oedge))
                continue;

            const dummyIdent = be[1] + '->' + be[0];
            if (!this.dummyChains.has(dummyIdent)) {
                // This is a self-edge or an edge that only spans one rank.
                const selfEdge = be[0] === be[1];
                const src = this.graph.get(be[0])!;
                const dst = selfEdge ? src : this.graph.get(be[1])!;
                const startX = src.x + (src.width / 2);
                const endX = dst.x + (dst.width / 2);
                const startY = selfEdge ? src.y + 10 : src.y;
                const endY = selfEdge ? startY + 20 : dst.y;
                oedge.points = [
                    { x: startX, y: startY },
                    { x: startX - BACKEDGE_SPACING, y: startY },
                    { x: startX - BACKEDGE_SPACING, y: endY },
                    { x: endX, y: endY },
                ];
            } else {
                const [_, dummyNodes] = this.dummyChains.get(dummyIdent)!;

                const dummyNode = this.graph.get(dummyNodes[0])!;
                const edgeX = dummyNode.x - (dummyNode.width / 2);
                const src = this.graph.get(be[0])!;
                const startX = src.x - (src.width / 2);
                const startY = src.y;
                const dst = this.graph.get(be[1])!;
                const endX = dst.x - (dst.width / 2);
                const endY = dst.y;

                this.graph.removeEdge(be[1], be[0]);
                oedge.points = [
                    { x: startX, y: startY },
                    { x: edgeX, y: startY },
                    { x: edgeX, y: endY },
                    { x: endX, y: endY },
                ];

                this.graph.addEdge(be[0], be[1], oedge);
                if (this.debug)
                    this.dagreGraph?.setEdge(be[0], be[1], oedge);
                for (const dn of dummyNodes) {
                    this.graph.removeNode(dn);
                    if (this.debug)
                        this.dagreGraph?.removeNode(dn);
                }
            }
            routedEdges.add(oedge);
        }
    }

    private permute(): void {
        for (const edge of this.graph.edgesIter())
            this.graph.edge(...edge)!.weight = 1;
        this.orderer.biasedMinCrossing();
    }

    /**
     * Assign concrete coordinate positions to nodes and edges according to
     * the nodes' ranks and order within ranks.
     * This routes all forward edges by inserting intermediate edge points to
     * make them curve without intersecting other graph elements.
     * @returns {Set<SMLayouterEdge>} The set of edges that were routed.
     */
    private assignPositions(): Set<SMLayouterEdge> {
        const routedEdges = new Set<SMLayouterEdge>();

        // Adjust the order attributes so the first non-backedge node is at 0.
        const nBePerRank = new Map<number, number>();
        const nTrailingDummiesPerRank = new Map<number, number>();
        let maxBeLanes = 0;
        for (const rank of this.rankDict.keys()) {
            const rankNodes = this.rankDict.get(rank)!;
            let offsetLeft = 0;
            let dummiesSinceLastNonDummy = 0;
            for (const nodeId of rankNodes) {
                const node = this.graph.get(nodeId)!;
                if (node instanceof DummyState) {
                    if (node.forBackChain)
                        offsetLeft++;
                    dummiesSinceLastNonDummy++;
                } else {
                    dummiesSinceLastNonDummy = 0;
                }
            }
            for (const nodeId of rankNodes) {
                const node = this.graph.get(nodeId)!;
                node.lane = (node.order ?? 0) - offsetLeft;
            }
            nBePerRank.set(rank, offsetLeft);
            nTrailingDummiesPerRank.set(rank, dummiesSinceLastNonDummy);
            maxBeLanes = Math.max(maxBeLanes, offsetLeft);
        }

        // Straighten out all edges.
        const dummyChainLanes = new Map<string, number>();
        for (const dummyChain of this.dummyChains.keys()) {
            let posLane = Number.NEGATIVE_INFINITY;
            let negLane = Number.POSITIVE_INFINITY;
            for (const nodeId of this.dummyChains.get(dummyChain)![1]) {
                const nd = this.graph.get(nodeId)!;
                const lanePre = nd.lane!;
                if (lanePre < 0)
                    negLane = Math.min(negLane, lanePre);
                else
                    posLane = Math.max(lanePre, posLane);
            }

            let tgtLane;
            if (negLane !== Number.POSITIVE_INFINITY)
                tgtLane = negLane;
            else
                tgtLane = posLane;
            for (const nodeId of this.dummyChains.get(dummyChain)![1])
                this.graph.get(nodeId)!.minLane = tgtLane;
            dummyChainLanes.set(dummyChain, tgtLane);
        }

        const sortedRanks = Array.from(this.rankDict.keys()).sort((a, b) => {
            return a - b;
        });
        const laneWidths = new Map<number, number>();
        const laneXPositions = new Map<number, number>();
        for (const rank of sortedRanks) {
            let i = 0 - nBePerRank.get(rank)!;
            for (const nodeId of this.rankDict.get(rank)!) {
                const node = this.graph.get(nodeId)!;
                if (node.minLane !== undefined)
                    i = node.minLane;
                node.lane = i;

                let ndWidth = node.width;
                if (node instanceof DummyState)
                    ndWidth = EDGE_WIDTH;

                laneWidths.set(i, Math.max(laneWidths.get(i) ?? 0, ndWidth));

                if (i < 0)
                    i = 0;
                else
                    i++;
            }
        }
        let x = 0;
        const inOrderLanes = Array.from(laneWidths.keys()).sort((a, b) => {
            return a - b;
        });
        const minLane = inOrderLanes[0];
        for (const lane of inOrderLanes) {
            const lWidth = laneWidths.get(lane)!;
            if (lane > minLane) {
                const prevLWidth = laneWidths.get(lane - 1)!;
                if (lWidth > EDGE_WIDTH && prevLWidth > EDGE_WIDTH)
                    x += NODE_SPACING;
                else
                    x += EDGE_SPACING;
            }
            laneXPositions.set(lane, x);
            x += lWidth;
        }

        let lastY = 0;
        let lastHeight = 0;
        let i = 0;
        for (const rank of sortedRanks) {
            const rankNodes = this.rankDict.get(rank)!;
            let thisHeight = 0;
            for (const nodeId of rankNodes) {
                const node = this.graph.get(nodeId)!;
                thisHeight = Math.max(thisHeight, node.height);
            }
            this.rankHeights.set(rank, thisHeight);

            const thisY = (
                lastY + (lastHeight / 2) + (i === 0 ? 0 : LAYER_SPACING) +
                (thisHeight / 2)
            );
            lastY = thisY;
            lastHeight = thisHeight;

            for (const nodeId of rankNodes) {
                const node = this.graph.get(nodeId)!;
                node.x = laneXPositions.get(node.lane!) ?? 0;
                node.y = thisY;
            }
            i++;
        }

        for (const edge of this.graph.edgesIter()) {
            // Here we don't want to route backedges, they are handled
            // separately (except for self edges).
            const srcRank = this.graph.get(edge[0])!.rank!;
            const dstRank = this.graph.get(edge[1])!.rank!;
            if (srcRank > dstRank)
                continue;

            const edgeData = this.graph.edge(edge[0], edge[1])!;
            const src = this.graph.get(edge[0])!;
            const dst = this.graph.get(edge[1])!;

            if (edge[0] === edge[1]) {
                // Self edge.
                const nodeLeftX = src.x - (src.width / 2);
                const edgeLeftX = nodeLeftX - BACKEDGE_SPACING / 2;
                const edgeBottomY = src.y + (src.height / 4);
                const edgeTopY = src.y - (src.height / 4);
                edgeData.points = [
                    { x: nodeLeftX, y: edgeBottomY },
                    { x: edgeLeftX, y: edgeBottomY },
                    { x: edgeLeftX, y: edgeTopY },
                    { x: nodeLeftX, y: edgeTopY },
                ];
            } else {
                edgeData.points = [
                    { x: src.x, y: src.y + (src.height / 2) },
                    { x: dst.x, y: dst.y - (dst.height / 2) },
                ];
            }
            if (this.debug && this.dagreGraph) {
                for (const oedge of this.dagreGraph.outEdges(edge[0]) ?? []) {
                    if (oedge.v === edge[0] && oedge.w === edge[1])
                        this.dagreGraph.edge(oedge)!.points = edgeData.points;
                }
            }

            // Set layout information.
            let minX = Number.POSITIVE_INFINITY;
            let maxX = Number.NEGATIVE_INFINITY;
            let minY = Number.POSITIVE_INFINITY;
            let maxY = Number.NEGATIVE_INFINITY;
            for (const p of edgeData.points) {
                minX = Math.min(minX, p.x);
                maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y);
                maxY = Math.max(maxY, p.y);
            }
            edgeData.x = (minX + maxX) / 2;
            edgeData.y = (minY + maxY) / 2;
            edgeData.width = maxX - minX;
            edgeData.height = maxY - minY;

            routedEdges.add(edgeData);
        }

        return routedEdges;
    }

    private makeAcyclic(): void {
        for (const [u, v] of this.backedgesCombined) {
            const ident = u + '->' + v;
            this.removedBackedges.set(ident, this.graph.edge(u, v));
            this.graph.removeEdge(u, v);
            this.graph.addEdge(v, u, { points: [], wasBackedge: true });
            if (this.debug && this.renderer) {
                this.dagreGraph?.removeEdge(u, v);
                const rendererEdge = new DummyInterstateEdge(
                    this.renderer, this.renderer.ctx, this.renderer.minimapCtx,
                    undefined, 0
                );
                rendererEdge.forBackChain = true;
                this.dagreGraph?.setEdge(v, u, rendererEdge);
            }
        }
    }

    private undoMakeAcyclic(): void {
        for (const e of this.graph.edges()) {
            const edgeData = this.graph.edge(e[0], e[1]);
            if (edgeData?.wasBackedge) {
                this.graph.removeEdge(e[0], e[1]);
                this.graph.addEdge(
                    e[1], e[0], this.removedBackedges.get(e[1] + '->' + e[0])
                );
                if (this.debug && this.renderer) {
                    this.dagreGraph?.removeEdge(e[0], e[1]);
                    const rendererEdge = new DummyInterstateEdge(
                        this.renderer, this.renderer.ctx,
                        this.renderer.minimapCtx, undefined, 0
                    );
                    this.dagreGraph?.setEdge(e[1], e[0], rendererEdge);
                }
            }
        }
    }

}
