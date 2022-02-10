import { Container } from 'pixi.js';
import {
    GraphEdge, GraphNode
} from './graph_element';

export class Graph extends Container {

    // TODO: change to maps of id -> node, to facilitate removing.
    public readonly nodes: GraphNode[] = [];
    public readonly edges: GraphEdge[] = [];

    public constructor() {
        super();
    }

    public draw(): void {
        this.nodes.forEach(node => {
            node.draw();
        });
        this.edges.forEach(edge => {
            edge.draw();
        });
    }

    public addNode(node: GraphNode): void {
        this.nodes.push(node);
        this.addChild(node);
    }

    public addEdge(edge: GraphEdge): void {
        this.edges.push(edge);
        this.addChild(edge);
    }

}
