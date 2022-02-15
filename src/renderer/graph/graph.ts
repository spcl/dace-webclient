import { Container } from 'pixi.js';
import { Box2D } from '../../utils/geometry/primitives';
import {
    GraphEdge, GraphNode, ScopedNode
} from './graph_element';
import { NestedSDFGNode } from './nested_sdfg_node';
import { State } from './state';

export class Graph extends Container {

    // TODO: change to maps of id -> node, to facilitate removing.
    protected readonly _nodes: GraphNode[] = [];
    protected readonly _edges: GraphEdge[] = [];

    public layoutGraph: any = null;
    public parentNode: GraphNode | null = null;

    public constructor() {
        super();
    }

    public draw(): void {
        this._nodes.forEach(node => {
            node.draw();
        });
        this._edges.forEach(edge => {
            edge.draw();
        });
    }

    public nodes(): GraphNode[] {
        return this._nodes;
    }

    public edges(): GraphEdge[] {
        return this._edges;
    }

    public addNode(node: GraphNode): void {
        this._nodes.push(node);
        this.addChild(node);
    }

    public addEdge(edge: GraphEdge): void {
        this._edges.push(edge);
        this.addChild(edge);
    }

    public inEdges(node: GraphNode): GraphEdge[] {
        const inEdges: GraphEdge[] = [];
        this._edges.forEach(edge => {
            if (edge.dst === node.id)
                inEdges.push(edge);
        });
        return inEdges;
    }

    public outEdges(node: GraphNode): GraphEdge[] {
        const outEdges: GraphEdge[] = [];
        this._edges.forEach(edge => {
            if (edge.src === node.id)
                outEdges.push(edge);
        });
        return outEdges;
    }

    public sources(): GraphNode[] {
        const sources: GraphNode[] = [];
        this._nodes.forEach(node => {
            if (this.inEdges(node).length === 0)
                sources.push(node);
        });
        return sources;
    }

    public sinks(): GraphNode[] {
        const sinks: GraphNode[] = [];
        this._nodes.forEach(node => {
            if (this.outEdges(node).length === 0)
                sinks.push(node);
        });
        return sinks;
    }

    public numNodes(): number {
        return this._nodes.length;
    }

    public numEdges(): number {
        return this._edges.length;
    }

    public numConnectors(): number {
        let sum = 0;
        this._nodes.forEach(node => {
            sum += node.inConnectors.length;
            sum += node.outConnectors.length;
        });
        return sum;
    }

    public allGraphs(): Graph[] {
        const graphs: Graph[] = [this];

        const addSubgraphs = (graph: Graph) => {
            graph._nodes.forEach(node => {
                if (node instanceof State) {
                    graphs.push(node.stateGraph);
                    addSubgraphs(node.stateGraph);
                } else if (node instanceof NestedSDFGNode) {
                    graphs.push(node.nestedGraph);
                    addSubgraphs(node.nestedGraph);
                } else if (node instanceof ScopedNode) {
                    graphs.push(node.scopedGraph);
                    addSubgraphs(node.scopedGraph);
                }
            });
        };
        addSubgraphs(this);

        return graphs;
    }

    public allNodes(): GraphNode[] {
        const nodes: GraphNode[] = [];

        this.allGraphs().forEach(subgraph => {
            subgraph.nodes().forEach(node => {
                nodes.push(node);
            });
        });

        return nodes;
    }
    
    public allEdges(): GraphEdge[] {
        const edges: GraphEdge[] = [];

        this.allGraphs().forEach(subgraph => {
            subgraph.edges().forEach(edge => {
                edges.push(edge);
            });
        });

        return edges;
    }

    public node(id: number): GraphNode | undefined {
        for (let i = 0; i < this._nodes.length; i++) {
            const node = this._nodes[i];
            if (node.id === id)
                return node;
            else if (node instanceof ScopedNode && node.exitId === id)
                return node;
        }
        return undefined;
    }

    public boundingBox(): Box2D {
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;

        this._nodes.forEach(node => {
            const box = node.boundingBox();
            minX = Math.min(minX, box.x);
            maxX = Math.max(maxX, box.x + box.width);
            minY = Math.min(minY, box.y);
            maxY = Math.max(maxY, box.y + box.height);
        });
        this._edges.forEach(edge => {
            const box = edge.boundingBox();
            minX = Math.min(minX, box.x);
            maxX = Math.max(maxX, box.x + box.width);
            minY = Math.min(minY, box.y);
            maxY = Math.max(maxY, box.y + box.height);
        });

        return new Box2D(minX, minY, maxX - minX, maxY - minY);
    }

}
