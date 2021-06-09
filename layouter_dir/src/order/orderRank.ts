import * as _ from "lodash";
import Node from "../graph/node";
import OrderGraph from "./orderGraph";
import OrderGroup from "./orderGroup";

export default class OrderRank extends Node<any, any>
{
    public readonly groups: Array<OrderGroup> = [];

    public order: Array<number> = [];
    public orderGraph: OrderGraph;
    public rank: number;

    constructor(rank: number = null) {
        super();
        this.rank = rank;
    }

    orderGroups(): void {
        this.order = _.map(_.sortBy(_.map(this.groups, (group: OrderGroup, n: number) => {
            return {n: n, pos: group.position};
        }), "pos"), "n");
    }

    orderedGroups(): Array<OrderGroup> {
        const groups = [];
        if (this.order.length !== this.groups.length) {
            this.orderGroups();
        }
        _.forEach(this.order, pos => {
            groups.push(this.groups[pos]);
        });
        return groups;
    }

    addGroup(group: OrderGroup, id: number = null): number {
        const nextIndex = this.groups.length;
        this.groups.push(group);
        group.index = nextIndex;
        group.rank = this;
        return this.orderGraph.addGroup(group, id);
    }
}
