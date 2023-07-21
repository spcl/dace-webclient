import { DiGraph } from '../di_graph';
import { Graph } from '../graph';

export function* dfsLabeledEdges(
    graph: DiGraph<unknown, unknown>, source: string, depthLimit?: number
): Generator<[string, string, 'forward' | 'reverse' | 'nontree']> {
    const visited = new Set();
    if (depthLimit === undefined)
        depthLimit = graph.numberOfNodes();

    let sources;
    if (source === undefined)
        sources = graph.nodes();
    else
        sources = [source];

    for (const start of sources) {
        if (visited.has(start))
            continue;
        yield [start, start, 'forward'];
        visited.add(start);
        const stack: [string, number, string[]][] = [
            [start, depthLimit, graph.successors(start)]
        ];

        while (stack.length) {
            const [parent, depth, succs] = stack[stack.length - 1];
            const child = succs.pop();
            if (child !== undefined) {
                if (visited.has(child)) {
                    yield [parent, child, 'nontree'];
                } else {
                    yield [parent, child, 'forward'];
                    visited.add(child);
                    if (depth > 1)
                        stack.push([child, depth - 1, graph.successors(child)]);
                }
            } else {
                stack.pop();
                if (stack.length)
                    yield [stack[stack.length - 1][0], parent, 'reverse'];
            }
        }
        yield [start, start, 'reverse'];
    }
}

export function* dfsPostorderNodes(
    graph: DiGraph<unknown, unknown>, start: string, depthLimit?: number
): Generator<string> {
    for (const edge of dfsLabeledEdges(graph, start, depthLimit)) {
        if (edge[2] === 'reverse')
            yield edge[1];
    }
}

export function* allReachable(
    graph: Graph<unknown, unknown>, start: string
): Generator<string> {
    const visited = new Set<string>();
    const stack = graph.neighbors(start);
    while (stack.length > 0) {
        const n = stack.pop()!;
        if (visited.has(n))
            continue;
        yield n;
        visited.add(n);
        stack.push(...graph.neighbors(n));
    }
}
