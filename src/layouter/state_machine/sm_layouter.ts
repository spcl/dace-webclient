import { DagreSDFG } from '../..';
import { allBackedges } from '../graphlib/algorithms/cycles';
import {
    dominatorTree,
    immediateDominators,
} from '../graphlib/algorithms/dominance';
import { DiGraph } from '../graphlib/di_graph';

const ARTIFICIAL_START = '__smlayouter_artifical_start';
const ARTIFICIAL_END = '__smlayouter_artifical_end';

const LAYER_SPACING = 50;
const NODE_SPACING = 50;

enum ScopeType {
    BRANCH,
    LOOP_REGULAR,
    LOOP_INVERTED,
}

export class SMLayouter {

    private readonly graph: DiGraph<unknown, unknown>;
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
    private readonly rankDict: Map<number, Set<string>>;
    private readonly orderDict: Map<string, number>;
    private readonly nodeRanks: Map<string, number>;
    private readonly dummyNodes: Set<string>;
    public readonly layout: Map<string, { x: number, y: number }>;

    public constructor(g: DiGraph<unknown, unknown>) {
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
                this.graph.addEdge(this.startNode, s);
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
                this.graph.addEdge(s, this.endNode);
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
        this.nodeRanks = new Map();
        this.orderDict = new Map();
        this.dummyNodes = new Set();
        this.layout = new Map();
    }

    public static layoutDagreCompat(dagreGraph: DagreSDFG): void {
        const g = new DiGraph();
        for (const stateId of dagreGraph.nodes())
            g.addNode(stateId, dagreGraph.node(stateId));
        for (const edge of dagreGraph.edges())
            g.addEdge(edge.v, edge.w, dagreGraph.edge(edge));

        const layout = SMLayouter.layout(g);

        // Translate the obtained layout to the dagre graph.
        for (const stateId of dagreGraph.nodes()) {
            const pos = layout.get(stateId);
            dagreGraph.node(stateId).x = pos!.x;
            dagreGraph.node(stateId).y = pos!.y;
        }
    }

    public doLayout(): void {
        this.doRanking();
        this.normalizeEdges();
        this.permute();
        this.assignPositions();
    }

    private static layout(
        g: DiGraph<unknown, unknown>
    ): Map<string, { x: number, y: number }> {
        const instance = new SMLayouter(g);
        instance.doLayout();
        return instance.layout;
    }

    private assignInitialRanks(): void {
        const q: [string, number][] = [[this.startNode, 0]];

        const scopes: [ScopeType, number, number][] = [];
        const visited = new Set<string>();
        const rankings = new Map<string, number>();

        while (q.length > 0) {
            const [node, rank] = q.shift()!;
            if (visited.has(node)) {
                // Assign the rank for the current node (passed along in the
                // queue).
                if (rankings.has(node))
                    rankings.set(node, Math.max(rankings.get(node)!, rank));
                else
                    rankings.set(node, rank);
            } else {
                const backedges = this.backedgesDstDict.get(node) ?? new Set();
                const eclipsedBackedges = this.eclipsedBackedgesDstDict.get(
                    node
                ) ?? new Set();

                // If a node has multiple predecessors, only process it if all
                // incoming edges (minus backedges) have been processed.
                let defer = false;
                for (const s of this.graph.predecessorsIter(node)) {
                    if (!visited.has(s)) {
                        let beSrc = false;
                        for (const be of backedges) {
                            if (be[0] === s) {
                                beSrc = true;
                                break;
                            }
                        }

                        for (const be of eclipsedBackedges) {
                            if (be[0] === s) {
                                beSrc = true;
                                break;
                            }
                        }

                        if (!beSrc) {
                            defer = true;
                            break;
                        }
                    }
                }

                if (defer) {
                    q.push([node, rank]);
                    continue;
                }

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
        this.nodeRanks.clear();
        for (const k of rankings.keys()) {
            const v = rankings.get(k)!;
            if (!this.rankDict.has(v))
                this.rankDict.set(v, new Set());
            this.rankDict.get(v)!.add(k);
            this.nodeRanks.set(k, v);
        }
    }

    private contractRanks(): void {
        const origRanks = Array.from(this.rankDict.keys());
        origRanks.sort();
        const contractedRanks = new Map<number, Set<string>>();
        let i = 0;
        for (const r of origRanks) {
            contractedRanks.set(i, this.rankDict.get(r)!);
            i++;
        }
        this.rankDict.clear();
        this.nodeRanks.clear();
        for (const k of contractedRanks.keys()) {
            this.rankDict.set(k, contractedRanks.get(k)!);
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

            // If the edge spans more than one rank, insert dummy nodes and
            // edges to normalize the edge.
            let eSrc = src;
            let eDst = null;
            for (let i = srcRank + 1; i < dstRank; i++) {
                const dummyNode = `__smlayouter_dummy_${nDummyNode}`;
                eDst = dummyNode;
                nDummyNode++;
                this.graph.addNode(dummyNode);
                this.dummyNodes.add(dummyNode);
                this.graph.addEdge(eSrc, eDst);
                eSrc = dummyNode;
            }
            eDst = dst;
            this.graph.addEdge(eSrc, eDst);
        }
    }

    private permute(): void {
        for (const node of this.graph.nodesIter())
            this.orderDict.set(node, 0);
    }

    private assignPositions(): void {
        let yPos = 0;
        for (const rank of this.rankDict.keys()) {
            const rankNodes = this.rankDict.get(rank)!;
            let xPos = 0;
            let maxHeight = 0;
            for (const nodeId of rankNodes) {
                this.layout.set(nodeId, { x: xPos, y: yPos });
                const node = this.graph.get(nodeId);
                console.log(nodeId);
                console.log(node);
                if (node && (node as any).width)
                    xPos += ((node as any).width + NODE_SPACING);
                else
                    xPos++;

                if (node && (node as any).height)
                    maxHeight = Math.max(maxHeight, (node as any).height);
            }

            yPos += (maxHeight + LAYER_SPACING);
        }

        // Assign everything else to the initial rank.
        let xPos = 0;
        for (const v of this.graph.nodesIter()) {
            if (!this.layout.has(v)) {
                this.layout.set(v, { x: xPos, y: 0 });
                xPos++;
            }
        }
    }

}
