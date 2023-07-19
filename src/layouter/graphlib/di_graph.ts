import { Graph } from './graph';

export class DiGraph<NodeT, EdgeT> extends Graph<NodeT, EdgeT> {

    private pred: Map<string, Map<string, EdgeT | null>> = new Map();
    private succ: Map<string, Map<string, EdgeT | null>> = new Map();

    public constructor(
        name: string = '',
    ) {
        super(name);
    }

    public addNode(id: string, node?: NodeT | null): void {
        super.addNode(id, node);
        if (!this.pred.has(id))
            this.pred.set(id, new Map());
        if (!this.succ.has(id))
            this.succ.set(id, new Map());
    }

    public removeNode(id: string): void {
        super.removeNode(id);
        this.pred.delete(id);
        this.succ.delete(id);
    }

    public addEdge(u: string, v: string, edge?: EdgeT | null): void {
        if (!this.nodeMap.has(u))
            this.addNode(u, undefined);
        if (!this.nodeMap.has(v))
            this.addNode(v, undefined);
        this.succ.get(u)?.set(v, edge ?? null);
        this.pred.get(v)?.set(u, edge ?? null);
    }

    public removeEdge(u: string, v: string): void {
        this.succ.get(u)?.delete(v);
        this.pred.get(v)?.delete(u);
    }

    public edge(u: string, v: string): EdgeT | null {
        const val = this.succ.get(u)?.get(v);
        if (val === undefined)
            throw new Error(`Edge ${u} -> ${v} does not exist`);
        return val;
    }

    public neighborsIter(id: string): IterableIterator<string> {
        const neighMap = this.succ.get(id);
        if (neighMap === undefined)
            throw new Error(`Node ${id} does not exist`);
        return neighMap.keys();
    }

    public numberOfEdges(): number {
        return this.edges().length;
    }

    public* edgesIter(): Generator<[string, string]> {
        for (const [u, neighbors] of this.succ)
            for (const v of neighbors.keys())
                yield [u, v];
    }

    public hasEdge(u: string, v: string): boolean {
        return this.succ.get(u)?.has(v) ?? false;
    }

    public successorsIter(id: string): IterableIterator<string> {
        return this.succ.get(id)?.keys() ?? new Map().keys();
    }

    public successors(id: string): string[] {
        return Array.from(this.successorsIter(id));
    }

    public predecessorsIter(id: string): IterableIterator<string> {
        return this.pred.get(id)?.keys() ?? new Map().keys();
    }

    public predecessors(id: string): string[] {
        return Array.from(this.predecessorsIter(id));
    }

    public* inEdgesIter(
        id: string
    ): Generator<[[string, string], EdgeT | null]> {
        for (const [u, edge] of this.pred.get(id) ?? new Map())
            yield [[u, id], edge];
    }

    public inEdges(id: string): [[string, string], EdgeT | null][] {
        return Array.from(this.inEdgesIter(id));
    }

    public* outEdgesIter(
        id: string
    ): Generator<[[string, string], EdgeT | null]> {
        for (const [v, edge] of this.succ.get(id) ?? new Map())
            yield [[id, v], edge];
    }

    public outEdges(id: string): [[string, string], EdgeT | null][] {
        return Array.from(this.outEdgesIter(id));
    }

    public inDegree(id: string): number {
        return this.pred.get(id)?.size ?? 0;
    }

    public outDegree(id: string): number {
        return this.succ.get(id)?.size ?? 0;
    }

    public sources(): string[] {
        return Array.from(this.sourcesIter());
    }

    public* sourcesIter(): Generator<string> {
        for (const [id, neighbors] of this.pred)
            if (neighbors.size === 0)
                yield id;
    }

    public sinks(): string[] {
        return Array.from(this.sinksIter());
    }

    public* sinksIter(): Generator<string> {
        for (const [id, neighbors] of this.succ)
            if (neighbors.size === 0)
                yield id;
    }

    public clear(): void {
        super.clear();
        this.pred.clear();
        this.succ.clear();
    }

    public copy(): DiGraph<NodeT, EdgeT> {
        const C = new DiGraph<NodeT, EdgeT>();
        for (const [nid, node] of this.nodeMap.entries()) {
            C.addNode(nid, node ?? undefined);
            C.pred.set(nid, new Map(this.pred.get(nid)));
            C.succ.set(nid, new Map(this.succ.get(nid)));
        }
        return C;
    }

    public reversed(): DiGraph<NodeT, EdgeT> {
        const R = new DiGraph<NodeT, EdgeT>();
        for (const [nid, node] of this.nodeMap.entries()) {
            R.addNode(nid, node ?? undefined);
            R.succ.set(nid, new Map(this.pred.get(nid)));
            R.pred.set(nid, new Map(this.succ.get(nid)));
        }
        return R;
    }

    public subgraph(nodes: Set<string>): DiGraph<NodeT, EdgeT> {
        const H = new DiGraph<NodeT, EdgeT>();
        for (const nId of nodes) {
            const node = this.nodeMap.get(nId);
            if (node !== undefined)
                H.addNode(nId, node);
        }

        for (const [u, v] of this.edgesIter()) {
            if (nodes.has(u) && nodes.has(v))
                H.addEdge(u, v, this.edge(u, v));
        }

        return H;
    }

}
