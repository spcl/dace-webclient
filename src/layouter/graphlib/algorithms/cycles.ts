import { DiGraph } from '../di_graph';
import { stronglyConnectedComponents } from './components';

export class NodeCycle<NodeT> {

    private _nodes: Set<NodeT> = new Set();

    constructor(nodes: NodeT[]) {
        this._nodes = new Set(nodes);
    }

    public get length(): number {
        return this._nodes.size;
    }

    public get nodes(): Set<NodeT> {
        return this._nodes;
    }

}

export function* simpleCycles(
    g: DiGraph<unknown, unknown>
): Generator<string[]> {

    function _unblock(
        thisnode: string, blocked: Set<string>, B: Map<string, Set<string>>
    ): void {
        const stack = [thisnode];
        while (stack.length > 0) {
            const node = stack.pop();
            if (node && blocked.has(node)) {
                blocked.delete(node);
                if (B.has(node)) {
                    for (const w of B.get(node)!)
                        stack.push(w);
                    B.delete(node);
                }
            }
        }
    }

    const subGraph = g.copy();
    const sccs: Set<string>[] = [];
    for (const scc of stronglyConnectedComponents(subGraph))
        if (scc.size > 1)
            sccs.push(scc);

    for (const node of subGraph.nodes()) {
        if (subGraph.hasEdge(node, node)) {
            yield [node];
            subGraph.removeEdge(node, node);
        }
    }

    while (sccs.length) {
        const scc = sccs.pop();
        if (scc) {
            const sccGraph = subGraph.subgraph(scc);
            const startNode = Array.from(scc)[0];
            scc.delete(startNode);
            const path = [startNode];
            const blocked: Set<string> = new Set();
            const closed: Set<string> = new Set();
            blocked.add(startNode);
            const B = new Map<string, Set<string>>();
            const stack: [string, string[]][] = [
                [startNode, sccGraph.neighbors(startNode)]
            ];

            while (stack.length > 0) {
                const [thisNode, nbrs] = stack[stack.length - 1];
                if (nbrs.length > 0) {
                    const nextNode = nbrs.pop();
                    if (nextNode === startNode) {
                        yield path.slice();
                        for (const n of path)
                            closed.add(n);
                    } else if (nextNode && !blocked.has(nextNode)) {
                        path.push(nextNode);
                        stack.push([nextNode, sccGraph.neighbors(nextNode)]);
                        closed.delete(nextNode);
                        blocked.add(nextNode);
                        continue;
                    }
                }

                if (nbrs.length === 0) {
                    if (closed.has(thisNode)) {
                        _unblock(thisNode, blocked, B);
                    } else {
                        for (const nbr of sccGraph.neighbors(thisNode)) {
                            if (B.get(nbr) === undefined)
                                B.set(nbr, new Set([thisNode]));
                            else if (!B.get(nbr)!.has(thisNode))
                                B.get(nbr)!.add(thisNode);
                        }
                    }

                    stack.pop();
                    path.pop();
                }
            }

            const H: DiGraph<unknown, unknown> = subGraph.subgraph(scc);
            for (const nscc of stronglyConnectedComponents(H)) {
                if (nscc.size > 1)
                    sccs.push(nscc);
            }
        }
    }
}

export function allBackedges(
    g: DiGraph<unknown, unknown>, start?: string, strict: boolean = false
): [Set<[string, string]>, Set<[string, string]>] {
    const backedges = new Set<[string, string]>();
    const eclipsedBackedges = new Set<[string, string]>();

    if (start === undefined)
        start = g.sources()[0];
    if (start === undefined)
        throw new Error('No start node specified and none could be found');

    // Gather all cycles in the graph. Cycles are represented as a sequence of
    // nodes.
    const allCycles = new Set<NodeCycle<string>>();
    for (const cycle of simpleCycles(g))
        allCycles.add(new NodeCycle(cycle));

    // Construct a dictionary mapping a node to the cycles containing that node.
    const cycleMap = new Map<string, Set<NodeCycle<string>>>();
    for (const cycle of allCycles) {
        for (const node of cycle.nodes) {
            if (!cycleMap.has(node))
                cycleMap.set(node, new Set());
            cycleMap.get(node)!.add(cycle);
        }
    }

    // Do a BFS traversal of the graph to detect the back edges.
    // For each node that is part of an (unhandled) cycle, find the longest
    // still unhandled cycle and try to use it to find the back edge for it.
    const bfsFrontier = [start];
    const visited = new Set<string>([start]);
    const handledCycles = new Set<NodeCycle<string>>();
    const unhandledCycles = allCycles;
    while (bfsFrontier.length > 0) {
        const node = bfsFrontier.shift()!;
        const predecessors = [];
        for (const p of g.predecessors(node)) {
            if (!visited.has(p))
                predecessors.push(p);
        }
        const longestCycles = new Map<string, NodeCycle<string>>();
        const cycles = cycleMap.get(node);
        if (cycles) {
            const removeCycles = new Set<NodeCycle<string>>();
            for (const cycle of cycles) {
                if (!handledCycles.has(cycle)) {
                    for (const p of predecessors) {
                        if (cycle.nodes.has(p)) {
                            if (!longestCycles.has(p)) {
                                longestCycles.set(p, cycle);
                            } else {
                                if (cycle.length > longestCycles.get(p)!.length)
                                    longestCycles.set(p, cycle);
                            }
                        }
                    }
                } else {
                    removeCycles.add(cycle);
                }
            }

            for (const cycle of removeCycles)
                cycles.delete(cycle);
        }

        // For the current node, find the incoming edge which belongs to the
        // cycle and has not been visited yet, which indicates a backedge.
        const nodeBackedgeCandidates = new Set<[
            [[string, string], unknown], NodeCycle<string>
        ]>();
        for (const cycleRaw of longestCycles) {
            const cycle = cycleRaw[1];
            handledCycles.add(cycle);
            unhandledCycles.delete(cycle);
            cycleMap.get(node)?.delete(cycle);
            const backedgeCandidates = g.inEdges(node);
            for (const candidate of backedgeCandidates) {
                const src = candidate[0][0];
                const dst = candidate[0][1];
                if (!visited.has(src) && cycle.nodes.has(src)) {
                    nodeBackedgeCandidates.add([candidate, cycle]);
                    if (!strict)
                        backedges.add(candidate[0]);

                    // Make sure that any cycle containing the back edge is
                    // not evaluated again, i.e., mark as handled.
                    const removeCycles = new Set<NodeCycle<string>>();
                    for (const cycle of unhandledCycles) {
                        if (cycle.nodes.has(src) && cycle.nodes.has(dst)) {
                            handledCycles.add(cycle);
                            removeCycles.add(cycle);
                        }
                    }
                    for (const cycle of removeCycles)
                        unhandledCycles.delete(cycle);
                }
            }
        }

        // If strict is set, we only report the longest cycle's back edges for
        // any given node, and separately return any other backedges as
        // 'eclipsed' backedges. In the case of a while-loop, for example,
        // the loop edge is considered a backedge, while a continue inside the
        // loop is considered an 'eclipsed' backedge.
        if (strict) {
            let longestCandidate = undefined;
            const eclipsedCandidates = new Set<[string, string]>();
            for (const candidate of nodeBackedgeCandidates) {
                if (!longestCandidate) {
                    longestCandidate = candidate;
                } else if (longestCandidate[1].length < candidate[1].length) {
                    eclipsedCandidates.add(longestCandidate[0][0]);
                    longestCandidate = candidate;
                } else {
                    eclipsedCandidates.add(candidate[0][0]);
                }
            }

            if (longestCandidate)
                backedges.add(longestCandidate[0][0]);

            if (eclipsedCandidates.size > 0) {
                for (const candidate of eclipsedCandidates)
                    eclipsedBackedges.add(candidate);
            }
        }

        // Continue the BFS.
        for (const neighbor of g.successors(node)) {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                bfsFrontier.push(neighbor);
            }
        }
    }

    if (strict)
        return [backedges, eclipsedBackedges];
    else
        return [backedges, new Set<[string, string]>()];
}
