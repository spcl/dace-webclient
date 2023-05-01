export interface GraphI<NodeT, EdgeT> {

    get(id: string): NodeT | undefined;
    addNode(id: string, node?: NodeT): void;
    addNodesWithAttributes(nodes: [string, NodeT][]): void;
    addNodes(nodes: string[]): void;
    removeNode(id: string): void;
    removeNodes(ids: string[]): void;
    numberOfNodes(): number;
    nodes(): string[];
    nodesIter(): IterableIterator<string>;
    addEdge(u: string, v: string, edge?: EdgeT): void;
    addEdgesWithAttributes(edges: [string, string, EdgeT][]): void;
    addEdges(edges: [string, string][]): void;
    removeEdge(u: string, v: string): void;
    hasEdge(u: string, v: string): boolean;
    edge(u: string, v: string): EdgeT | undefined;
    neighbors(id: string): string[];
    neighborsIter(id: string): IterableIterator<string>;
    edges(): [string, string][];
    edgesIter(): Generator<[string, string]>;
    numberOfEdges(): number;
    adjList(): (string | [string, string])[];
    adjListIter(): Generator<string | [string, string]>;
    clear(): void;
    copy(): GraphI<NodeT, EdgeT>;
    subgraph(nodes: Set<string>): GraphI<NodeT, EdgeT>;

}
