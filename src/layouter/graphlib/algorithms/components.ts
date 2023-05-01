import { DiGraph } from '../di_graph';

export function* stronglyConnectedComponents(
    g: DiGraph<unknown, unknown>
): Generator<Set<string>> {
    const preorder = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const sccFound = new Set<string>();
    const sccQueue: string[] = [];

    let i = 0;

    for (const source of g.nodes()) {
        if (!sccFound.has(source)) {
            const queue = [source];
            while (queue.length) {
                const v = queue[queue.length - 1];
                if (!preorder.has(v)) {
                    i++;
                    preorder.set(v, i);
                }

                let done = true;
                for (const w of g.neighborsIter(v)) {
                    if (!preorder.has(w)) {
                        queue.push(w);
                        done = false;
                        break;
                    }
                }

                if (done) {
                    lowlink.set(v, preorder.get(v)!);
                    for (const w of g.neighborsIter(v)) {
                        if (!sccFound.has(w)) {
                            if (preorder.get(w)! > preorder.get(v)!)
                                lowlink.set(v, Math.min(
                                    lowlink.get(v)!, lowlink.get(w)!
                                ));
                            else
                                lowlink.set(v, Math.min(
                                    lowlink.get(v)!, preorder.get(w)!
                                ));
                        }
                    }
                    queue.pop();
                    if (lowlink.get(v)! === preorder.get(v)!) {
                        const scc = new Set<string>([v]);
                        while (
                            sccQueue.length &&
                            preorder.get(sccQueue[sccQueue.length - 1])! >
                                preorder.get(v)!
                        )
                            scc.add(sccQueue.pop()!);
                        for (const val of scc)
                            sccFound.add(val);
                        yield scc;
                    } else {
                        sccQueue.push(v);
                    }
                }
            }
        }
    }
}
