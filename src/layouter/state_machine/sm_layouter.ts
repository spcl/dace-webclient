import { DagreSDFG } from '../..';
import * as dagre from 'dagre';
import { allBackedges } from '../graphlib/algorithms/cycles';
import {
    dominatorTree,
    immediateDominators,
} from '../graphlib/algorithms/dominance';
import { DiGraph } from '../graphlib/di_graph';
import { allReachable } from '../graphlib/algorithms/traversal';

const dagreOrder = require('dagre/lib/order');

const ARTIFICIAL_START = '__smlayouter_artifical_start';
const ARTIFICIAL_END = '__smlayouter_artifical_end';

const LAYER_SPACING = 50;
const NODE_SPACING = 50;
const BACKEDGE_SPACING = 20;
const SKIP_EDGES_CENTER_OFFSET = 50; // Given in percent.

enum ScopeType {
    BRANCH,
    LOOP_REGULAR,
    LOOP_INVERTED,
}

type BackedgeT = {
    distance: number,
    srcRank: number,
    dstRank: number,
    edge: [string, string],
    children: BackedgeT[],
    depth?: number,
    root?: BackedgeT,
    maxDepth?: number,
};

type BackedgeEventT = {
    rank: number,
    type: 'src' | 'dst',
    edge: BackedgeT,
};

export interface SMLayouterNode {
    width: number;
    height: number;
    x: number;
    y: number;
    order?: number;
    rank?: number;
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
    private readonly dummyChains: Set<[SMLayouterEdge, string[]]>;

    public constructor(g: DiGraph<SMLayouterNode, SMLayouterEdge>) {
        this.graph = g;

        this.rankDict = new Map();
        this.rankHeights = new Map();
        this.dummyChains = new Set();

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
    }

    /**
     * Perform state machine layout for an existing dagre.js layout graph.
     * This translates the dagre graph into a minimal DiGraph necessary for
     * performing the layout.
     * @param {DagreSDFG} dagreGraph Dagre.js graph to perform layouting for.
     */
    public static layoutDagreCompat(dagreGraph: DagreSDFG): void {
        const g = new DiGraph<SMLayouterNode, SMLayouterEdge>();
        for (const stateId of dagreGraph.nodes())
            g.addNode(stateId, dagreGraph.node(stateId));
        for (const edge of dagreGraph.edges())
            g.addEdge(edge.v, edge.w, dagreGraph.edge(edge));

        SMLayouter.layout(g);
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
        this.normalizeEdges();
        this.permute();
        const routedEdges = this.assignPositions();
        const denormalizedEdges = this.denormalizeEdges();
        for (const edge of denormalizedEdges)
            routedEdges.add(edge);
        this.routeBackEdges(routedEdges);

        this.checkUnroutedEdges(routedEdges);
    }

    /**
     * Lay out a DiGraph.
     * @param {DiGraph<SMLayouterNode, SMLayouterEdge>} g Graph to lay out.
     */
    private static layout(g: DiGraph<SMLayouterNode, SMLayouterEdge>): void {
        // Construct a layouter instance (runs preparation phase) and perform
        // the laying out. Clean up afterwards by removing dummy start and end
        // nodes if they were added.
        const instance = new SMLayouter(g);
        instance.doLayout();
        if (instance.startNode === ARTIFICIAL_START)
            g.removeNode(ARTIFICIAL_START);
        if (instance.endNode === ARTIFICIAL_END)
            g.removeNode(ARTIFICIAL_END);

        const loopScopes = instance.getLoopScopes();
        console.log(loopScopes);
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
        if (unrouted.size > 0)
            console.warn(
                'The following edges were not routed:',
                unrouted
            );
    }

    /**
     * Assign all layout nodes to initial layout ranks.
     * This may leave certain ranks empty to conservatively ensure vertical
     * layout constraints are met.
     */
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
                    const oNode = Array.from(backedges)[0][0];
                    let exitCandidates = new Set<string>();
                    for (const n of successors)
                        if (n !== oNode && !this.allDom.get(n)?.has(oNode))
                            exitCandidates.add(n);
                    for (const n of this.graph.successorsIter(node))
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

            // Self-edges do not need to be normalized.
            if (src === dst)
                continue;

            const srcRank = this.graph.get(src)!.rank!;
            const dstRank = this.graph.get(dst)!.rank!;

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
                    rank: i,
                });
                dummyChain.push(dummyNode);
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

    /**
     * De-normalize any previously noramlized edge paths.
     * This merges normalized edge paths back together into a singular edge.
     * @returns {Set<SMLayouterEdge>} Set of routed edges after this step.
     */
    private denormalizeEdges(): Set<SMLayouterEdge> {
        const routedEdges = new Set<SMLayouterEdge>();
        const skipEdges = new Set<SMLayouterEdge>();

        for (const [oEdge, dummyChain] of this.dummyChains) {
            if (dummyChain.length < 1)
                continue;

            let chainSrc = null;
            let chainDst = null;
            const points = [];
            for (const dummyNode of dummyChain) {
                const rank = this.graph.get(dummyNode)!.rank!;
                this.rankDict.set(rank, this.rankDict.get(rank)!.filter(
                    (v) => v !== dummyNode
                ));
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
            const sourceX = sn.x + (sn.width / 200) * SKIP_EDGES_CENTER_OFFSET;
            oEdge.points = [
                { x: sourceX, y: sn.y + (sn.height / 2) },
                ...points,
                { x: dn.x, y: dn.y - (dn.height / 2) },
            ];
            this.graph.addEdge(chainSrc!, chainDst!, oEdge);

            for (const dummyNode of dummyChain)
                this.graph.removeNode(dummyNode);

            skipEdges.add(oEdge);
        }
        this.dummyChains.clear();

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
    private routeBackEdges(routedEdges: Set<SMLayouterEdge>): void {
        // -------------------------------------------
        // Determine the scopes for backedges.
        // -------------------------------------------
        const backedgeEvents: BackedgeEventT[] = [];
        for (const be of this.backedgesCombined) {
            const edgeData = this.graph.edge(be[0], be[1])!;
            if (routedEdges.has(edgeData))
                continue;

            const dstRank = this.graph.get(be[1])!.rank!;
            const srcRank = this.graph.get(be[0])!.rank!;
            const distance = Math.abs(dstRank - srcRank);
            const backedge: BackedgeT = {
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
        const openBackedges: BackedgeT[] = [];
        const handledBackedges = new Set<BackedgeT>();
        const topLevelBackedges = new Set<BackedgeT>();
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
                        event.edge.root!.maxDepth = Math.max(
                            event.edge.root!.maxDepth ?? 0, event.edge.depth!
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
        const lanes = new Map<number, BackedgeT[]>();
        for (let i = 0; i < maxDepth + 1; i++)
            lanes.set(i, []);

        const recursiveFlipDepths = (be: BackedgeT, maxD: number) => {
            be.depth = maxD - be.depth!;
            for (const child of be.children)
                recursiveFlipDepths(child, maxD);
        };
        for (const be of topLevelBackedges)
            recursiveFlipDepths(be, be.maxDepth ?? 0);

        const recursiveAssignLanes = (be: BackedgeT) => {
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
                const edgeData = this.graph.edge(be.edge[0], be.edge[1])!;
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

    /**
     * Perform in-rank permutations to ensure the number of edge crossings is
     * minimized.
     */
    private permute(): void {
        // TODO: replace this so we do not need to use dagre for this.
        const dagreGraph = new dagre.graphlib.Graph({
            directed: true,
            multigraph: false,
            compound: false,
        });
        for (const node of this.graph.nodesIter()) {
            const rank = this.graph.get(node)!.rank!;
            dagreGraph.setNode(node, { rank: rank });
        }
        for (const edge of this.graph.edgesIter()) {
            const src = edge[0];
            const dst = edge[1];
            dagreGraph.setEdge(src, dst, { weight: 1 });
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

    /**
     * Assign concrete coordinate positions to nodes and edges according to
     * the nodes' ranks and order within ranks.
     * This routes all forward edges by inserting intermediate edge points to
     * make them curve without intersecting other graph elements.
     * @returns {Set<SMLayouterEdge>} The set of edges that were routed.
     */
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
            const srcRank = this.graph.get(edge[0])!.rank!;
            const dstRank = this.graph.get(edge[1])!.rank!;
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

    public getLoopScopes() {
        const loopScopes = new Set<Set<string>>();
        for (const be of this.backedges) {
            const src = this.graph.get(be[0]);
            const dst = this.graph.get(be[1]);
            if (src && dst && src.rank !== undefined &&
                dst.rank !== undefined && src.rank !== dst.rank) {
                const upper = src.rank < dst.rank ? be[0] : be[1];
                const cutoffRank = src.rank < dst.rank ? dst.rank : src.rank;
                const reachableFromUpper = allReachable(this.graph, upper);
                const loopScope = new Set<string>();
                for (const reached of reachableFromUpper) {
                    const reachedNode = this.graph.get(reached);
                    if (reachedNode && reachedNode.rank !== undefined &&
                        reachedNode.rank <= cutoffRank)
                        loopScope.add(reached);
                }
                if (loopScope.size)
                    loopScopes.add(loopScope);
            }
        }
        return loopScopes;
    }

}
