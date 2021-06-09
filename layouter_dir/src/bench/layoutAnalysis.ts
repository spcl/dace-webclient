import * as _ from "lodash";
import LayoutConnector from "../layoutGraph/layoutConnector";
import LayoutEdge from "../layoutGraph/layoutEdge";
import LayoutGraph from "../layoutGraph/layoutGraph";
import LayoutNode from "../layoutGraph/layoutNode";
import Segment from "../geometry/segment";

export default class LayoutAnalysis {
    private readonly _layoutGraph: LayoutGraph;
    private readonly _options: any;
    private readonly _nodes: Array<LayoutNode>;
    private readonly _edges: Array<LayoutEdge>;
    private readonly _segments: Array<Segment>;
    private readonly _uniqueSegments: Array<Segment>;
    private readonly _nodeParents: Map<LayoutNode, Set<LayoutNode>>;
    private readonly _edgeParents: Map<LayoutEdge, Set<LayoutNode>>;


    constructor(layout: LayoutGraph, options: any = {}) {
        this._layoutGraph = layout;
        this._options = _.defaults(options, {
            targetEdgeLength: 50,
            weightBends: 0.2,
            weightCrossings: 1,
            weightLengths: 0.1,
        });
        this._nodes = this._layoutGraph.allNodes();
        this._edges = this._layoutGraph.allEdges();
        this._segments = _.flatMap(this._edges, (edge: LayoutEdge) => edge.segments());
        this._uniqueSegments = _.map(_.uniqBy(_.map(this._segments, segment => [segment, segment.start.x + "_" + segment.start.y + "_" + segment.end.x + "_" + segment.end.x]), "1"), "0");

        // precalculate all parents for nodes and edges
        this._nodeParents = new Map();
        _.forEach(this._nodes, (node: LayoutNode) => {
            const parents: Set<LayoutNode> = new Set();
            _.forEach(node.parents(), (parent: LayoutNode) => {
                parents.add(parent);
            });
            this._nodeParents.set(node, parents);
        });
        this._edgeParents = new Map();
        _.forEach(this._edges, (edge: LayoutEdge) => {
            const parents: Set<LayoutNode> = new Set();
            _.forEach(edge.parents(), (parent: LayoutNode) => {
                parents.add(parent);
            });
            this._edgeParents.set(edge, parents);
        });
    }

    /**
     * Returns the total number of pairwise segment crossings in the graph.
     */
    segmentCrossings(): number {
        return this._getAllCrossingSegments().length;
    }

    /**
     * Returns the cost for segment crossings in the graph.
     * For every pairwise crossing, the cost is between 1 and 2 depending on the crossing angle.
     * Orthogonal crossings have a cost of 1, almost parallel segments a cost very close to 2.
     */
    segmentCrossingsWithAngles(): number {
        let cost = 0;
        _.forEach(this._getAllCrossingSegments(), ([segI, segJ]) => {
            const angle = segI.vector().acuteAngleTo(segJ.vector());
            const angleCost = (Math.cos(2 * angle) + 1) / 2;
            cost += 1 + angleCost;
        });
        return cost;
    }

    edgeLengths(): number {
        let cost = 0;
        _.forEach(this._edges, (edge: LayoutEdge) => {
            const edgeLength = _.sum(_.map(edge.segments(), segment => segment.length()));
            let factor = edgeLength / this._options["targetEdgeLength"];
            cost += Math.max(factor, 1 / factor);
        });
        return cost;
    }

    checkUpwardFlow(): boolean {
        let hasUpwardFlow = false;
        _.forEach(this._edges, (edge: LayoutEdge) => {
            if (hasUpwardFlow) {
                return; // break not possible in forEach
            }
            if (!edge.graph.mayHaveCycles && edge.points[0].y > _.last(edge.points).y) {
                console.log("edge goes upwards", edge);
                hasUpwardFlow = true;
            }
        });
        return !hasUpwardFlow;
    }

    checkNodeOverlaps(): boolean {
        for (let i = 0; i < this._nodes.length; ++i) {
            const nodeA = this._nodes[i];
            for (let j = i + 1; j < this._nodes.length; ++j) {
                const nodeB = this._nodes[j];
                if (nodeA.boundingBox().intersects(nodeB.boundingBox()) && !this._nodesRelated(nodeA, nodeB)) {
                    console.log("two nodes overlap", nodeA, nodeB);
                    return false;
                }
            }
        }
        return true;
    }

    checkEdgeOverlaps(): boolean {
        for (let i = 0; i < this._edges.length; ++i) {
            const edge = this._edges[i];
            for (let j = 0; j < this._nodes.length; ++j) {
                const node = this._nodes[j];
                if (this._edgeIntersectsNode(edge, node) && !this._edgeParents.get(edge).has(node)) {
                    console.log("node overlaps edge", node, edge);
                    return false;
                }
            }
        }
        return true;
    }

    checkNodeContainment(): boolean {
        for (let i = 0; i < this._nodes.length; ++i) {
            const node = this._nodes[i];
            let contained = true;
            this._nodeParents.get(node).forEach((parent: LayoutNode) => {
                contained = contained && node.boundingBox().containedIn(parent.boundingBox());
            });
            if (!contained) {
                console.log("node not contained in parent", node, node.boundingBox(), _.map(Array.from(this._nodeParents.get(node)), (parent: LayoutNode) => parent.boundingBox()));
                return false;
            }
        }
        return true;
    }

    checkEdgeContainment(): boolean {
        for (let i = 0; i < this._edges.length; ++i) {
            const edge = this._edges[i];
            let contained = true;
            this._edgeParents.get(edge).forEach((parent: LayoutNode) => {
                contained = contained && edge.boundingBox().containedIn(parent.boundingBox())
            });
            if (!contained) {
                console.log("edge not contained in parent", edge);
                return false;
            }
        }
        return true;
    }

    checkMapAlignment(): boolean {
        // gather all graphs
        const graphs = [];
        const addSubGraphs = (graph: LayoutGraph) => {
            graphs.push(graph);
            _.forEach(graph.nodes(), (node: LayoutNode) => {
                if (node.childGraph !== null) {
                    addSubGraphs(node.childGraph);
                }
            })
        };
        addSubGraphs(this._layoutGraph);

        let aligned = true;
        _.forEach(graphs, (graph: LayoutGraph) => {
            if (!aligned) {
                return; // break not possible in forEach
            }
            if (graph.entryNode !== null && graph.exitNode !== null) {
                if (graph.entryNode.x !== graph.exitNode.x || graph.entryNode.width !== graph.exitNode.width) {
                    console.log("entry and exit node not aligned", graph.entryNode, graph.exitNode);
                    aligned = false;
                }
            }
        });
        return aligned;
    }

    checkConnectorAlignment(): boolean {
        let aligned = true;
        _.forEach(this._nodes, (node: LayoutNode) => {
            if (!aligned) {
                return; // break not possible in forEach
            }
            _.forEach(node.inConnectors, (inConnector: LayoutConnector) => {
                if (!aligned) {
                    return; // break not possible in forEach
                }
                if (inConnector.isScoped) {
                    const outConnector = node.connector("OUT", "OUT_" + inConnector.name.substr(3));
                    if (inConnector.x !== outConnector.x) {
                        console.log("IN connector and OUT connector not aligned", inConnector, outConnector);
                        aligned = false;
                    }
                }
            });
        });
        return aligned;
    }

    validate(): boolean {
        return (
            this.checkUpwardFlow() &&
            this.checkNodeOverlaps() &&
            this.checkEdgeOverlaps() &&
            this.checkNodeContainment() &&
            this.checkEdgeContainment() &&
            this.checkMapAlignment() &&
            this.checkConnectorAlignment()
        );
    }

    bends(): number {
        return this._segments.length - this._edges.length;
    }

    cost(breakdown: boolean = false): number {
        const crossings = this.segmentCrossingsWithAngles();
        const bends = this.bends();
        const lengths = this.edgeLengths();
        const weightedCrossings = this._options.weightCrossings * crossings;
        const weightedBends = this._options.weightBends * bends;
        const weightedLengths = this._options.weightLengths * lengths;
        if (breakdown) {
            console.log("Crossings: " + this._options.weightCrossings + " * " + crossings.toFixed(2) + " = " + weightedCrossings.toFixed(2));
            console.log("Bends: " + this._options.weightBends + " * " + bends.toFixed(2) + " = " + weightedBends.toFixed(2));
            console.log("Lengths: " + this._options.weightLengths + " * " + lengths.toFixed(2) + " = " + weightedLengths.toFixed(2));
        }
        return weightedCrossings + weightedBends + weightedLengths;
    }

    private _edgeIntersectsNode(edge: LayoutEdge, node: LayoutNode): boolean {
        const nodeBox = node.boundingBox();
        if (!edge.boundingBox().intersects(nodeBox)) {
            return false;
        }
        let intersects = false;
        _.forEach(edge.segments(), (segment: Segment) => {
            intersects = intersects || segment.intersectsBox(nodeBox);
        });
        return intersects;
    }

    private _nodesRelated(nodeA: LayoutNode, nodeB: LayoutNode): boolean {
        return this._nodeParents.get(nodeA).has(nodeB) || this._nodeParents.get(nodeB).has(nodeA);
    }

    private _printCrossings(): void {
        _.map(_.sortBy(_.map(this._getAllCrossingSegments(), ([segI, segJ]: [Segment, Segment]) => {
            const point = segI.intersection(segJ);
            return {
                pointx: point.x,
                pointy: point.y,
                segi: segI,
                segj: segJ,
            };
        }), ["pointy", "pointx"]), data => console.log("(" + data.pointx.toFixed(0) + " / " + data.pointy.toFixed(0) + ")", data.segi.toString(), data.segj.toString()));
    }

    private _getAllCrossingSegments(): Array<[Segment, Segment]> {
        const overlaps = {};
        _.forEach(["x", "y"], axis => {
            overlaps[axis] = new Array(this._segments.length);
            for (let i = 0; i < this._uniqueSegments.length; ++i) {
                overlaps[axis][i] = [];
            }
            const endpoints = [];
            for (let i = 0; i < this._uniqueSegments.length; ++i) {
                endpoints.push([this._uniqueSegments[i].start[axis], i, this._uniqueSegments[i].start[axis] <= this._uniqueSegments[i].end[axis]]);
                endpoints.push([this._uniqueSegments[i].end[axis], i, this._uniqueSegments[i].start[axis] > this._uniqueSegments[i].end[axis]]);
            }
            let openSegments = new Set();
            _.forEach(_.sortBy(endpoints, "0"), ([coord, segId, isFirst]) => {
                if (isFirst) {
                    openSegments.forEach((openSegId: number) => {
                        let min = Math.min(openSegId, segId);
                        let max = Math.max(openSegId, segId);
                        overlaps[axis][min].push(max);
                    });
                    openSegments.add(segId);
                } else {
                    openSegments.delete(segId);
                }
            });
        });
        const intersections = [];
        for (let i = 0; i < this._uniqueSegments.length; ++i) {
            const segI = this._uniqueSegments[i];
            _.forEach(_.intersection(overlaps["y"][i], overlaps["x"][i]), (j: number) => {
                const segJ = this._uniqueSegments[j];
                if (segI.intersects(segJ)) {
                    intersections.push([segI, segJ]);
                }
            });
        }
        return intersections;
    }
}