import * as _ from "lodash";
import Edge from "../graph/edge";
import Graph from "../graph/graph";
import Node from "../graph/node";
import OrderNode from "./orderNode";
import OrderRank from "./orderRank";

export default class OrderGroup extends Node<Graph<any, any>, Edge<any, any>> {
    public readonly reference: any;
    public shuffleHierarchy: Array<any> = null;
    public nodes: Array<OrderNode> = [];

    public order: Array<number> = [];
    public position: number = 0;
    public rank: OrderRank;
    public index: number = 0; // the index within the rank, used as an id, other than position this does not change

    constructor(reference: any, label: string = null) {
        super(label);
        this.reference = reference;
    }

    addNode(node: OrderNode, id: number = null): number {
        const nextIndex = this.nodes.length;
        this.nodes.push(node);
        node.group = this;
        node.index = nextIndex;
        node.rank = this.rank.rank;
        return this.rank.orderGraph.addNode(node, id);
    }

    removeNode(node: OrderNode): void {
        this.rank.orderGraph.removeNode(node.id);
        for (let i = node.index + 1; i < this.nodes.length; ++i) {
            this.nodes[i].index--;
        }
        _.pull(this.nodes, node);
    }

    orderNodes(): void {
        this.order = _.map(_.sortBy(_.map(this.nodes, (node: OrderNode, n: number) => {
            return {n: n, pos: node.position};
        }), "pos"), "n");
    }

    orderedNodes(): Array<OrderNode> {
        const nodes = [];
        if (this.order.length !== this.nodes.length) {
            this.orderNodes();
        }
        _.forEach(this.order, (pos: number) => {
            nodes.push(this.nodes[pos]);
        });
        return nodes;
    }
}
