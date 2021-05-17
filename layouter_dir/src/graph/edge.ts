import Graph from "./graph";
import Node from "./node";

export default class Edge<GraphT extends Graph<any, any>, NodeT extends Node<any, any>> {
    public id: number;
    public graph: GraphT;
    public src: number;
    public dst: number;
    public weight: number = 1;
    public isInverted: boolean = false;

    constructor(src: number, dst: number, weight: number = 1) {
        this.src = src;
        this.dst = dst;
        this.weight = weight;
    }

    toString(): string {
        return this.graph.node(this.src).label() + " ---(" + this.weight + ")---> " + this.graph.node(this.dst).label();
    }

    parents(): Array<NodeT> {
        const parents = [];
        let graph = this.graph;
        while (graph.parentNode !== null) {
            parents.push(graph.parentNode);
            graph = graph.parentNode.graph;
        }
        return parents;
    }
}