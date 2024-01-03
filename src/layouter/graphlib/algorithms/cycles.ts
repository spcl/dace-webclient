import { DiGraph } from '../di_graph';
import { stronglyConnectedComponents } from './components';

export class NodeCycle<NodeT> {

    private _nodes: Set<NodeT> = new Set();
    private _edges: Set<string> = new Set();

    constructor(nodes: NodeT[], edges: [string, string][]) {
        this._nodes = new Set(nodes);
        this._edges = new Set();
        for (const e of edges)
            this._edges.add(e.toString());
    }

    /**
     * Get the length of a cycle, which is given by the number of edges
     * that make up the cycle.
     */
    public get length(): number {
        return this._edges.size;
    }

    public get nodes(): Set<NodeT> {
        return this._nodes;
    }

    public get edges(): Set<string> {
        return this._edges;
    }

}

export function* simpleCycles(
    g: DiGraph<unknown, unknown>
): Generator<[string[], [string, string][]]> {

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
        const selfEdge: [string, string] = [node, node];
        if (subGraph.hasEdge(node, node)) {
            yield [[node], [selfEdge]];
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
            const edgePath: [string, string][] = [];
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
                        const retEdge: [string, string] = [thisNode, nextNode];
                        edgePath.push(retEdge);
                        yield [path.slice(), edgePath.slice()];
                        edgePath.pop();
                        for (const n of path)
                            closed.add(n);
                    } else if (nextNode && !blocked.has(nextNode)) {
                        path.push(nextNode);
                        edgePath.push([thisNode, nextNode]);
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
                    edgePath.pop();
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
    const backedgeMap = new Map<string, Set<[string, string]>>();
    const eclipsedBackedges = new Set<[string, string]>();

    if (start === undefined) {
        const sources = g.sources();
        if (sources.length === 1)
            start = sources[0];
    }
    if (start === undefined)
        throw new Error('No start node specified and none could be found');

    const visited = new Set<string>();
    const locked = new Set<string>();

    const dfsWalk = (node: string) => {
        visited.add(node);
        locked.add(node);

        for (const succ of g.successorsIter(node)) {
            if (!visited.has(succ)) {
                dfsWalk(succ);
            } else if (locked.has(succ)) {
                // Backedge found.
                const be: [string, string] = [node, succ];
                backedges.add(be);
                if (strict) {
                    if (!backedgeMap.has(succ))
                        backedgeMap.set(succ, new Set([be]));
                    else
                        backedgeMap.get(succ)!.add(be);
                }
            }
        }

        locked.delete(node);
    };

    dfsWalk(start);

    if (!strict)
        return [backedges, eclipsedBackedges];

    backedges.clear();
    eclipsedBackedges.clear();

    const allCycles = new Set<NodeCycle<string>>();
    for (const cycle of simpleCycles(g))
        allCycles.add(new NodeCycle(cycle[0], cycle[1]));

    const cycleMap = new Map<string, Set<NodeCycle<string>>>();
    for (const cycle of allCycles) {
        for (const node of cycle.nodes) {
            if (!cycleMap.has(node))
                cycleMap.set(node, new Set());
            cycleMap.get(node)!.add(cycle);
        }
    }

    for (const target of backedgeMap.keys()) {
        const nodeBackedges = backedgeMap.get(target) ?? new Set([]);
        if (nodeBackedges.size === 1) {
            backedges.add(Array.from(nodeBackedges)[0]);
        } else {
            let longestEdge = undefined;
            let maxLen = 0;
            for (const be of nodeBackedges) {
                for (const cycle of cycleMap.get(target) ?? []) {
                    if (cycle.edges.has(be.toString())) {
                        if (cycle.length > maxLen) {
                            maxLen = cycle.length;
                            if (longestEdge !== undefined && longestEdge !== be)
                                eclipsedBackedges.add(longestEdge);
                            longestEdge = be;
                        } else {
                            eclipsedBackedges.add(be);
                        }
                    }
                }
            }
            if (longestEdge === undefined)
                throw Error('No backedge candidate for target node ' + target);
            backedges.add(longestEdge);
        }
    }

    return [backedges, eclipsedBackedges];
}
