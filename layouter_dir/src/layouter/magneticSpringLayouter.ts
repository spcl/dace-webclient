import * as _ from "lodash";
import LayoutEdge from "../layoutGraph/layoutEdge";
import LayoutGraph from "../layoutGraph/layoutGraph";
import LayoutNode from "../layoutGraph/layoutNode";
import RecursiveLayouter from "./recursiveLayouter";
import Vector from "../geometry/vector";

export default class MagneticSpringLayouter extends RecursiveLayouter {
    public static NUM_ITERATIONS = 100;
    public static STEP_SIZE = 0.1;
    public static SPRING_WEIGHT = 1;
    public static REPULSIVE_WEIGHT = 1;
    public static MAGNETIC_WEIGHT = 1;

    layoutSizedGraph(graph: LayoutGraph) {
        switch (graph.nodes().length) {
            case 1:
                // just one node => place it anywhere
                graph.nodes()[0].setPosition(new Vector());
                break;

            case 2:
                // two nodes => place them above each other
                const topIndex = Math.round(Math.random());
                const topNode = graph.nodes()[topIndex];
                const bottomNode = graph.nodes()[1 - topIndex];
                topNode.setPosition(new Vector(-topNode.width / 2, -topNode.height / 2));
                bottomNode.setPosition(new Vector(-bottomNode.width / 2, topNode.height / 2 + this._options.targetEdgeLength));
                break;

            default:
                // more nodes => place them on a circle
                const sToC = 2 / 3 * Math.PI / Math.sqrt(3);
                let circumference = graph.nodes().length * this._options.targetEdgeLength;
                const nodeDiagonals = [];
                _.forEach(graph.nodes(), (node) => {
                    nodeDiagonals[node.id] = Math.sqrt(node.width * node.width + node.height * node.height);
                    circumference += nodeDiagonals[node.id];
                });
                circumference *= sToC;
                const diameter = circumference / Math.PI;
                const radius = diameter / 2;
                let angle = 0;
                const shuffledNodes = _.shuffle(graph.nodes());
                _.forEach(shuffledNodes, (node, i) => {
                    const center = new Vector(radius * Math.sin(angle), radius * Math.cos(angle));
                    const topLeft = new Vector(center.x - node.width / 2, center.y - node.height / 2);
                    node.setPosition(topLeft);
                    if (i < graph.nodes().length - 1) {
                        angle += 2 * Math.asin((this._options.targetEdgeLength + nodeDiagonals[node.id] / 2 + nodeDiagonals[shuffledNodes[i + 1].id] / 2) / diameter);
                    }
                });
        }

        // precompute set of neighbors and non-neighbors
        const neighbors = [];
        const nonNeighbors = [];
        _.forEach(graph.nodes(), (nodeA) => {
            neighbors[nodeA.id] = new Set();
            nonNeighbors[nodeA.id] = new Set();
            _.forEach(graph.outEdges(nodeA.id), (edge) => {
                const dst = edge.dst;
                if (dst !== nodeA.id) {
                    neighbors[nodeA.id].add(dst);
                }
            });
            _.forEach(graph.inEdges(nodeA.id), (edge) => {
                const src = edge.src;
                if (src !== nodeA.id) {
                    neighbors[nodeA.id].add(src);
                }
            });
            _.forEach(graph.nodes(), (nodeB) => {
                if (nodeA.id !== nodeB.id && !neighbors[nodeA.id].has(nodeB.id)) {
                    nonNeighbors[nodeA.id].add(nodeB.id);
                }
            });
        });

        function distanceVector(srcNode: LayoutNode, dstNode: LayoutNode) {
            const srcPoint = new Vector(srcNode.x + srcNode.width / 2, srcNode.y + srcNode.height);
            const dstPoint = new Vector(dstNode.x + dstNode.width / 2, dstNode.y);
            return dstPoint.sub(srcPoint);
        }


        for (let iteration = 0; iteration < MagneticSpringLayouter.NUM_ITERATIONS; ++iteration) {
            _.forEach(graph.nodes(), (node: LayoutNode) => {
                const springForce = new Vector();
                const repulsiveForce = new Vector();
                neighbors[node.id].forEach(neighbor => {
                    const distanceVec = distanceVector(node, <LayoutNode>graph.node(neighbor));
                    const strength = Math.log(distanceVec.length() / this._options.targetEdgeLength);
                    springForce.add(distanceVec.normalize().multiplyScalar(strength));
                });
                nonNeighbors[node.id].forEach(nonNeighbor => {
                    const distanceVec = distanceVector(node, <LayoutNode>graph.node(nonNeighbor));
                    const length = distanceVec.length();
                    const strength = 1 / (length * length);
                    repulsiveForce.add(distanceVec.normalize().multiplyScalar(strength));
                });
                const force = springForce.multiplyScalar(MagneticSpringLayouter.SPRING_WEIGHT);
                force.add(repulsiveForce.multiplyScalar(MagneticSpringLayouter.REPULSIVE_WEIGHT));
                const offset = force.multiplyScalar(MagneticSpringLayouter.STEP_SIZE);
                node.translate(offset.x, offset.y);
            });
        }

        // place edges
        _.forEach(graph.edges(), (edge: LayoutEdge) => {
            const srcNode = <LayoutNode>graph.node(edge.src);
            const srcPoint = new Vector(srcNode.x + srcNode.width / 2, srcNode.y + srcNode.height);
            const dstNode = <LayoutNode>graph.node(edge.dst);
            const dstPoint = new Vector(dstNode.x + dstNode.width / 2, dstNode.y);
            edge.points = [srcPoint, dstPoint];
        });
    }
}