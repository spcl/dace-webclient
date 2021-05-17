import Edge from "../graph/edge";
import LayoutNode from "../layoutGraph/layoutNode";
import LevelGraph from "./levelGraph";
import Node from "../graph/node";

export default class LevelNode extends Node<LevelGraph, Edge<any, any>> {
    public rank: number = null;
    public position: number = null;
    public width: number = null;
    public x: number = null;

    public layoutNode: LayoutNode;
    public isFirst: boolean;
    public isLast: boolean;

    constructor(layoutNode: LayoutNode, rank: number, isFirst: boolean = false) {
        super(layoutNode.label());
        this.layoutNode = layoutNode;
        this.rank = rank;
        this.width = layoutNode.width;
        this.isFirst = isFirst;
    }
}
