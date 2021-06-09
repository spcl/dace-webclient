import {CONNECTOR_SIZE} from "../util/constants";
import * as _ from "lodash";
import Box from "../geometry/box";
import Graph from "../graph/graph";
import LayoutEdge from "./layoutEdge";
import LayoutNode from "./layoutNode";
import LevelGraph from "../levelGraph/levelGraph";
import LevelNode from "../levelGraph/levelNode";

export default class LayoutGraph extends Graph<LayoutNode, LayoutEdge> {
    public readonly mayHaveCycles: boolean;

    public entryNode: LayoutNode = null;
    public exitNode: LayoutNode = null;

    public minRank: number = 0;
    public numRanks: number = 1;

    private _levelGraph: LevelGraph = null;
    private _maxNodesPerRank: number = null;

    constructor(mayHaveCycles: boolean = false) {
        super();
        this.mayHaveCycles = mayHaveCycles;
    }

    allGraphs(): Array<LayoutGraph> {
        const allGraphs = [<LayoutGraph>this];
        const addSubgraphs = (graph: LayoutGraph) => {
            _.forEach(graph.nodes(), (node: LayoutNode) => {
                if (node.childGraph !== null) {
                    allGraphs.push(node.childGraph);
                    addSubgraphs(node.childGraph);
                }
                _.forEach(node.childGraphs, (childGraph: LayoutGraph) => {
                    allGraphs.push(childGraph);
                    addSubgraphs(childGraph);
                });
            });
        };
        addSubgraphs(this);
        return allGraphs;
    }

    translateElements(x: number, y: number) {
        _.forEach(this.nodes(), (node: LayoutNode) => {
            node.translate(x, y);
        });
        _.forEach(this.edges(), (edge: LayoutEdge) => {
            edge.translate(x, y);
        });
    }

    boundingBox(includeEdges: boolean = true): Box {
        const nodes = this.nodes();
        if (nodes.length === 0) {
            return new Box(0, 0, 0, 0);
        }
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        _.forEach(nodes, (node: LayoutNode) => {
            const box = node.boundingBox();
            if (_.some(node.inConnectors, connector => !connector.isTemporary)) {
                box.y -= CONNECTOR_SIZE / 2;
            }
            if (_.some(node.outConnectors, connector => !connector.isTemporary)) {
                box.height += CONNECTOR_SIZE / 2;
            }
            minX = Math.min(minX, box.x);
            maxX = Math.max(maxX, box.x + box.width);
            minY = Math.min(minY, box.y);
            maxY = Math.max(maxY, box.y + box.height);
        });
        if (includeEdges) {
            _.forEach(this.edges(), (edge: LayoutEdge) => {
                const box = edge.boundingBox();
                minX = Math.min(minX, box.x);
                maxX = Math.max(maxX, box.x + box.width);
                minY = Math.min(minY, box.y);
                maxY = Math.max(maxY, box.y + box.height);
            });
        }
        return new Box(minX, minY, maxX - minX, maxY - minY);
    }

    public globalRanks(): Array<Array<LayoutNode>> {
        const nodesPerRank = new Array(this.numRanks);
        for (let r = 0; r < this.numRanks; ++r) {
            nodesPerRank[r] = [];
        }
        _.forEach(this.allNodes(), (node: LayoutNode) => {
            nodesPerRank[node.rank].push(node);
        });
        return nodesPerRank;
    }

    public offsetRank(offset: number): void {
        this.minRank += offset;
        _.forEach(this.nodes(), node => {
            node.offsetRank(offset);
        });
    }

    public maxNodesPerRank(): number {
        if (this._maxNodesPerRank === null) {
            let max = 0;
            _.forEach(this.levelGraph().ranks(), (rank: Array<LevelNode>) => {
                let num = 0;
                _.forEach(rank, (levelNode: LevelNode) => {
                    if (levelNode.layoutNode.isScopeNode) {
                        num += levelNode.layoutNode.childGraphs[0].maxNodesPerRank();
                    } else {
                        num++;
                    }
                });
                max = Math.max(max, num);
            });
            this._maxNodesPerRank = max;
        }
        return this._maxNodesPerRank;
    }

    public levelGraph(): LevelGraph {
        const addSubgraph = (subgraph: LayoutGraph) => {
            _.forEach(subgraph.nodes(), (node: LayoutNode) => {
                this._levelGraph.addLayoutNode(node);
            });
            _.forEach(this.edges(), (edge: LayoutEdge) => {
                this._levelGraph.addLayoutEdge(edge);
            });
        };
        if (this._levelGraph === null) {
            this._levelGraph = new LevelGraph();
            addSubgraph(this);
        }
        return this._levelGraph;
    }

    public setLevelGraph(levelGraph: LevelGraph) {
        this._levelGraph = levelGraph;
    }
}
