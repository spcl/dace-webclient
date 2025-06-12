// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { DiGraph } from '../di_graph';
import { dfsPostorderNodes } from './traversal';

export function immediateDominators(
    g: DiGraph<unknown, unknown>, start: string
): Map<string, string> {
    const idom = new Map<string, string>();
    idom.set(start, start);

    const order = Array.from(dfsPostorderNodes(g, start));
    const dfn = new Map<string, number>();
    for (let i = 0; i < order.length; ++i)
        dfn.set(order[i], i);
    order.pop();
    order.reverse();

    function intersect(u: string, v: string): string {
        while (u !== v) {
            let uDfn = dfn.get(u);
            let vDfn = dfn.get(v);
            while (uDfn !== undefined && vDfn !== undefined && uDfn < vDfn) {
                u = idom.get(u) ?? u;
                uDfn = dfn.get(u);
            }
            while (uDfn !== undefined && vDfn !== undefined && vDfn < uDfn) {
                v = idom.get(v) ?? v;
                vDfn = dfn.get(v);
            }
        }
        return u;
    }

    let changed = true;
    while (changed) {
        changed = false;
        for (const u of order) {
            const predList: string[] = [];
            for (const v of g.predecessors(u)) {
                if (idom.has(v))
                    predList.push(v);
            }

            const newIdom = predList.reduce(intersect);
            if (!idom.has(u) || newIdom !== idom.get(u)) {
                idom.set(u, newIdom);
                changed = true;
            }
        }
    }

    return idom;
}

export function dominatorTree(
    graph: DiGraph<unknown, unknown>, start: string, idoms?: Map<string, string>
): [Map<string, Set<string>>, DiGraph<{ level: number }, unknown>] {
    idoms ??= immediateDominators(graph, start);

    const allDominated = new Map<string, Set<string>>();
    for (const n of graph.nodes())
        allDominated.set(n, new Set<string>());
    const domTree = new DiGraph<{ level: number }, unknown>();

    for (const [node, dom] of idoms) {
        if (node === dom)
            continue;

        domTree.addEdge(dom, node);
        allDominated.get(dom)?.add(node);

        let nextIdom = idoms.get(dom);
        let ndom = undefined;
        if (nextIdom !== undefined && nextIdom !== dom)
            ndom = nextIdom;

        while (ndom !== undefined) {
            allDominated.get(ndom)?.add(node);
            nextIdom = idoms.get(ndom);
            if (nextIdom !== undefined && nextIdom !== ndom)
                ndom = nextIdom;
            else
                ndom = undefined;
        }
    }

    // Rank the nodes in the dominator tree, i.e. assign a number to each node
    // that represents the distance from the root of the tree.
    const q: [string, number][] = [[start, 0]];
    while (q.length) {
        const [node, rank] = q.shift()!;
        domTree.addNode(node, { level: rank });
        for (const succ of domTree.successors(node))
            q.push([succ, rank + 1]);
    }

    return [allDominated, domTree];
}
