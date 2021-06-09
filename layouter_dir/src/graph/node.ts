import Graph from "./graph";
import Edge from "./edge";

export default class Node<GraphT extends Graph<any, any>, EdgeT extends Edge<any, any>> {
    public id: number;
    public graph: GraphT;
    public childGraph: GraphT = null;
    public readonly data: any;

    private _label: string = "";

    constructor(label: string = "", data: any = null) {
        this._label = label;
        this.data = data;
    }

    public label(): string {
        return this._label;
    }

    public setLabel(label: string = ""): void {
        this._label = label;
    }

    setChildGraph(childGraph: GraphT): void {
        childGraph.parentNode = this;
        this.childGraph = childGraph;
    }

    parents(): Array<this> {
        const parents = [];
        let graph = this.graph;
        while (graph.parentNode !== null) {
            parents.push(graph.parentNode);
            graph = graph.parentNode.graph;
        }
        return parents;
    }
}
