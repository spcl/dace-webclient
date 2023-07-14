import { GraphI } from './graph_types';

export class Graph<NodeT, EdgeT> implements GraphI<NodeT, EdgeT> {

    protected nodeMap: Map<string, NodeT | null> = new Map();
    protected adjacencyList: Map<string, Map<string, EdgeT | null>> = new Map();

    public constructor(
        public name: string = '',
    ) {
        return;
    }

    public get(id: string): NodeT | null {
        const val = this.nodeMap.get(id);
        if (val === undefined)
            throw new Error(`Node ${id} does not exist`);
        return val;
    }

    public addNode(id: string, node?: NodeT | null): void {
        this.nodeMap.set(id, node ?? null);
        if (!this.adjacencyList.has(id))
            this.adjacencyList.set(id, new Map());
    }

    public addNodesWithAttributes(nodes: [string, NodeT][]): void {
        for (const [id, node] of nodes)
            this.addNode(id, node);
    }

    public addNodes(nodes: string[]): void {
        for (const node of nodes)
            this.addNode(node, undefined);
    }

    public removeNode(id: string): void {
        if (this.nodeMap.delete(id)) {
            this.adjacencyList.get(id)?.forEach((_, v) => {
                this.adjacencyList.get(v)?.delete(id);
            });
            this.adjacencyList.delete(id);
        }
    }

    public removeNodes(ids: string[]): void {
        for (const id of ids)
            this.removeNode(id);
    }

    public numberOfNodes(): number {
        return this.nodeMap.size;
    }

    public nodes(): string[] {
        return Array.from(this.nodeMap.keys());
    }

    public nodesIter(): IterableIterator<string> {
        return this.nodeMap.keys();
    }

    public addEdge(u: string, v: string, edge?: EdgeT | null): void {
        if (!this.nodeMap.has(u))
            this.addNode(u);
        if (!this.nodeMap.has(v))
            this.addNode(v);
        this.adjacencyList.get(u)?.set(v, edge ?? null);
        this.adjacencyList.get(v)?.set(u, edge ?? null);
    }

    public addEdgesWithAttributes(edges: [string, string, EdgeT][]): void {
        for (const [u, v, edge] of edges)
            this.addEdge(u, v, edge);
    }

    public addEdges(edges: [string, string][]): void {
        for (const [u, v] of edges)
            this.addEdge(u, v, undefined);
    }

    public removeEdge(u: string, v: string): void {
        this.adjacencyList.get(u)?.delete(v);
        this.adjacencyList.get(v)?.delete(u);
    }

    public hasEdge(u: string, v: string): boolean {
        return (this.adjacencyList.get(u)?.has(v) ?? false) ||
            (this.adjacencyList.get(v)?.has(u) ?? false);
    }

    public edge(u: string, v: string): EdgeT | null {
        const val = this.adjacencyList.get(u)?.get(v);
        if (val === undefined)
            throw new Error(`Edge ${u} <-> ${v} does not exist`);
        return val;
    }

    public neighbors(id: string): string[] {
        return Array.from(this.neighborsIter(id));
    }

    public neighborsIter(id: string): IterableIterator<string> {
        const node = this.adjacencyList.get(id);
        if (node === undefined)
            throw new Error(`Node ${id} does not exist`);
        return node.keys();
    }

    public edges(): [string, string][] {
        return Array.from(this.edgesIter());
    }

    public* edgesIter(): Generator<[string, string]> {
        const taken = new Set<[string, string]>();
        for (const [src, adj] of this.adjacencyList.entries()) {
            for (const dst of adj.keys())
                if (!taken.has([dst, src]) && !taken.has([src, dst]))
                    yield [src, dst];
        }
    }

    public numberOfEdges(): number {
        return this.edges().length / 2;
    }

    public adjList(): (string | [string, string])[] {
        return Array.from(this.adjListIter());
    }

    public* adjListIter(): Generator<string | [string, string]> {
        for (const [src, adj] of this.adjacencyList.entries()) {
            if (adj.size)
                for (const dst of adj)
                    yield [src, dst[0]];
            else
                yield src;
        }
    }

    public clear(): void {
        this.name = '';
        this.nodeMap.clear();
        this.adjacencyList.clear();
    }

    public copy(): Graph<NodeT, EdgeT> {
        const C = new Graph<NodeT, EdgeT>();
        for (const [nid, node] of this.nodeMap.entries()) {
            C.addNode(nid, node ?? undefined);
            C.adjacencyList.set(nid, new Map(this.adjacencyList.get(nid)));
        }
        return C;
    }

    public subgraph(nodes: Set<string>): Graph<NodeT, EdgeT> {
        const H = new Graph<NodeT, EdgeT>();
        for (const nId of nodes) {
            const node = this.nodeMap.get(nId);
            H.addNode(nId, node);
        }

        for (const [u, v] of this.edgesIter()) {
            if (nodes.has(u) && nodes.has(v))
                H.addEdge(u, v, this.edge(u, v));
        }

        return H;
    }

}
