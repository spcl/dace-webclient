import Edge from "../graph/edge";
import Node from "../graph/node";
import RankGraph from "./rankGraph";

export default class RankNode extends Node<RankGraph, Edge<any, any>> {
    public rank: number = null;
}
