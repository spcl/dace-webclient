import {DEBUG} from "../util/constants";
import * as _ from "lodash";
import Assert from "../util/assert";
import Edge from "./edge";
import Graph from "./graph";
import Node from "./node";

export default class Component<NodeT extends Node<any, any>, EdgeT extends Edge<any, any>> {
    protected _nodeIds: Array<number> = [];
    protected _nodes: Array<NodeT> = [];
    protected _edgeIds: Array<number> = [];
    protected _graph: Graph<NodeT, EdgeT>;

    private _maxId: number = null;

    constructor(graph: Graph<NodeT, EdgeT>) {
        this._graph = graph;
    }

    public addNode(id: number): void {
        this._nodeIds.push(id);
        this._nodes.push(this._graph.node(id));
    }

    public addEdge(id: number): void {
        this._edgeIds.push(id);
    }

    public node(id: number): NodeT {
        return this._graph.node(id);
    }

    public nodes(): Array<NodeT> {
        return _.clone(this._nodes);
    }

    public edges(): Array<EdgeT> {
        const edges = [];
        _.forEach(this._edgeIds, id => {
            edges.push(this._graph.edge(id));
        });
        return edges;
    }

    public induceEdges(): void {
        this._nodeIds = _.sortBy(this._nodeIds);
        _.forEach(this.nodes(), node => {
            _.forEach(this.outEdges(node.id), outEdge => {
                if (_.sortedIndexOf(this._nodeIds, outEdge.dst) !== -1) {
                    this._edgeIds.push(outEdge.id);
                }
            });
        });
    }

    public outEdges(id: number): Array<EdgeT> {
        return this._graph.outEdges(id);
    }

    public toposort(): Array<NodeT> {
        const sortedNodes = [];
        const predecessors = _.fill(new Array(this.maxId() + 1), 0);
        _.forEach(this.edges(), edge => {
            predecessors[edge.dst]++;
        });
        const queue = [];
        let queuePointer = 0;
        _.forEach(this._nodeIds, (nodeId: number) => {
            if (predecessors[nodeId] === 0) {
                queue.push(nodeId);
            }
        });
        while (queuePointer < queue.length) {
            const nodeId = queue[queuePointer++];
            sortedNodes.push(this._graph.node(nodeId));
            _.forEach(this.outEdges(nodeId), (edge: EdgeT) => {
                predecessors[edge.dst]--;
                if (predecessors[edge.dst] === 0) {
                    queue.push(edge.dst);
                }
            });
        }
        if (DEBUG) {
            Assert.assert(this._nodeIds.length === sortedNodes.length, "toposort does not return all nodes");
        }
        return sortedNodes;
    }

    public maxId(): number {
        if (this._maxId === null) {
            this._maxId = 0;
            _.forEach(this._nodeIds, (nodeId: number) => {
                this._maxId = Math.max(this._maxId, nodeId);
            });
        }
        return this._maxId;
    }
}
