// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { GraphI } from './graph_types';


type NodeLabelFn<NodeT> = (v: string) => NodeT | null;

const GRAPH_ROOT = '__compound_graph_root__';

export class Graph<NodeT, EdgeT> implements GraphI<NodeT, EdgeT> {

    protected nodeMap = new Map<string, NodeT | null>();
    protected adjacencyList = new Map<string, Map<string, EdgeT | null>>();

    protected _parent?: Map<string, string | undefined>;
    protected _children?: Map<string, Map<string, boolean>>;

    protected _data: unknown;

    protected _defaultNodeLabel: NodeLabelFn<NodeT> = () => null;

    public constructor(
        public name: string = '',
        private readonly compound: boolean = false
    ) {
        if (compound) {
            this._parent = new Map<string, string>();
            this._children = new Map<string, Map<string, boolean>>();
            this._children.set(GRAPH_ROOT, new Map<string, boolean>());
        }
    }

    public get(id: string): NodeT | null {
        const val = this.nodeMap.get(id);
        if (val === undefined)
            throw new Error(`Node ${id} does not exist`);
        return val;
    }

    public has(id: string): boolean {
        return this.nodeMap.get(id) !== undefined;
    }

    public parent(id: string): string | undefined {
        if (!this.compound)
            return undefined;
        const retval = this._parent!.get(id);
        if (retval === undefined)
            throw new Error(`Node ${id} does not exist`);
        return retval;
    }

    public setParent(id: string, parent?: string): void {
        if (!this.compound)
            throw new Error('Cannot set parent in a non-compound graph');
        if (parent !== undefined) {
            let ancestor: string | undefined = parent;
            while (ancestor !== undefined) {
                if (ancestor === id)
                    throw new Error('Setting parent would create a cycle');
                ancestor = this._parent!.get(ancestor);
            }
        }

        const oldParent = this._parent!.get(id);
        if (oldParent !== undefined)
            this._children!.get(oldParent)?.delete(id);
        this._parent!.set(id, parent);
        if (parent !== undefined) {
            if (!this._children!.has(parent))
                this._children!.set(parent, new Map<string, boolean>());
            this._children!.get(parent)!.set(id, true);
        }
    }

    public children(id?: string): string[] {
        if (!this.compound) {
            if (id === undefined)
                return this.nodes();
            else if (this.nodeMap.has(id))
                return [];
        } else if (id !== undefined) {
            const children = this._children!.get(id);
            if (children !== undefined)
                return Array.from(children.keys());
        }
        throw new Error(`Node ${id ?? 'undefined'} does not exist`);
    }

    public setDefaultNodeLabel(label: NodeT | NodeLabelFn<NodeT>): void {
        if (typeof label !== 'function')
            this._defaultNodeLabel = () => label;
        else
            this._defaultNodeLabel = label as NodeLabelFn<NodeT>;
    }

    public addNode(id: string, node?: NodeT | null): void {
        this.nodeMap.set(id, node ?? this._defaultNodeLabel(id));
        if (!this.adjacencyList.has(id)) {
            // Node did not exist before.
            this.adjacencyList.set(id, new Map());
            if (this.compound) {
                this._parent!.set(id, undefined);
                this._children!.set(id, new Map());
                if (!this._children!.has(GRAPH_ROOT))
                    this._children!.set(GRAPH_ROOT, new Map());
                this._children!.get(GRAPH_ROOT)!.set(id, true);
            }
        }
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

            if (this.compound) {
                const parent = this._parent!.get(id);
                if (parent !== undefined)
                    this._children!.get(parent)?.delete(id);
                this._parent!.delete(id);
                const children = this._children!.get(id);
                if (children !== undefined) {
                    for (const child of children.keys()) {
                        this._parent!.set(child, undefined);
                        if (!this._children!.has(GRAPH_ROOT))
                            this._children!.set(GRAPH_ROOT, new Map());
                        this._children!.get(GRAPH_ROOT)!.set(child, true);
                    }
                }
                this._children!.delete(id);
            }
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
            for (const dst of adj.keys()) {
                if (!taken.has([dst, src]) && !taken.has([src, dst]))
                    yield [src, dst];
            }
        }
    }

    public numberOfEdges(): number {
        // Report half the number of actual edges, since the graph is
        // bidirectional, which is represented by two edges going either way.
        return this.edges().length / 2;
    }

    public adjList(): (string | [string, string])[] {
        return Array.from(this.adjListIter());
    }

    public* adjListIter(): Generator<string | [string, string]> {
        for (const [src, adj] of this.adjacencyList.entries()) {
            if (adj.size) {
                for (const dst of adj)
                    yield [src, dst[0]];
            } else {
                yield src;
            }
        }
    }

    public clear(): void {
        this.name = '';
        this.nodeMap.clear();
        if (this.compound) {
            this._parent = new Map<string, string>();
            this._children = new Map<string, Map<string, boolean>>();
            this._children.set(GRAPH_ROOT, new Map<string, boolean>());
        }
    }

    public copy(): Graph<NodeT, EdgeT> {
        // TODO: Adapt to compound graphs.
        const C = new Graph<NodeT, EdgeT>(this.name, this.compound);
        for (const [nid, node] of this.nodeMap.entries()) {
            C.addNode(nid, node ?? undefined);
            C.adjacencyList.set(nid, new Map(this.adjacencyList.get(nid)));
        }
        return C;
    }

    public subgraph(nodes: Set<string>): Graph<NodeT, EdgeT> {
        // TODO: Adapt to compound graphs.
        const H = new Graph<NodeT, EdgeT>(undefined, this.compound);
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

    public setData(data: unknown): void {
        this._data = data;
    }

    public getData(): unknown {
        return this._data;
    }

}
