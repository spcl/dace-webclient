import * as _ from "lodash";
import Edge from "../graph/edge";
import Graph from "../graph/graph";
import LayoutEdge from "../layoutGraph/layoutEdge";
import LayoutNode from "../layoutGraph/layoutNode";
import LevelNode from "./levelNode";

export default class LevelGraph extends Graph<LevelNode, Edge<any, any>> {
    private _ranks: Array<Array<LevelNode>> = null;
    private _minRank: number = Number.POSITIVE_INFINITY;
    private _maxRank: number = Number.NEGATIVE_INFINITY;
    private _firstNodeMap: Array<number> = [];
    private _lastNodeMap: Array<number> = [];

    constructor() {
        super();
    }

    public addLayoutNode(layoutNode: LayoutNode): LevelNode {
        let levelNode = new LevelNode(layoutNode, layoutNode.rank, true);
        let src = this.addNode(levelNode);
        this._firstNodeMap[layoutNode.id] = levelNode.id;
        const levelNodes = [levelNode];
        for (let r = layoutNode.rank + 1; r < layoutNode.rank + layoutNode.rankSpan; ++r) {
            this._maxRank = Math.max(this._maxRank, r);
            levelNode = new LevelNode(layoutNode, r);
            levelNodes.push(levelNode);
            let dst = this.addNode(levelNode);
            this.addEdge(new Edge(src, dst, Number.POSITIVE_INFINITY));
            src = dst;
        }
        levelNode.isLast = true;
        this._lastNodeMap[layoutNode.id] = levelNode.id;
        layoutNode.levelNodes = levelNodes;
        return levelNode;
    }

    public addLayoutEdge(layoutEdge: LayoutEdge): void {
        const src = this._lastNodeMap[layoutEdge.src];
        const dst = this._firstNodeMap[layoutEdge.dst];
        let existingEdge = this.edgeBetween(src, dst);
        if (existingEdge === undefined) {
            this.addEdge(new Edge(src, dst, layoutEdge.weight));
        } else {
            existingEdge.weight += layoutEdge.weight;
        }
    }

    public ranks(): Array<Array<LevelNode>> {
        this._minRank = Number.POSITIVE_INFINITY;
        this._maxRank = Number.NEGATIVE_INFINITY;
        _.forEach(this.nodes(), (node: LevelNode) => {
            this._minRank = Math.min(this._minRank, node.rank);
            this._maxRank = Math.max(this._maxRank, node.rank);
        });
        const minRank = this._minRank;
        const maxRank = this._maxRank;
        let numRanks = maxRank - minRank + 1;
        if (maxRank === Number.NEGATIVE_INFINITY) {
            numRanks = 0;
        }
        this._ranks = new Array(numRanks);
        const unsortedRanks = new Array(numRanks);
        for (let r = 0; r < numRanks; ++r) {
            unsortedRanks[r] = [];
        }
        _.forEach(this.nodes(), (node: LevelNode) => {
            unsortedRanks[node.rank - minRank].push(node);
        });
        _.forEach(unsortedRanks, (rank: Array<LevelNode>, r: number) => {
            this._ranks[r] = _.sortBy(rank, (node: LevelNode) => {
                return node.position;
            });
            for (let pos = 0; pos < this._ranks[r].length; ++pos) {
                this._ranks[r][pos].position = pos;
            }
        });
        return this._ranks;
    }

    public invalidateRankOrder(): void {
        this._ranks = null;
    }

    public maxX(): number {
        let maxX = Number.NEGATIVE_INFINITY;
        _.forEach(this.nodes(), (node: LevelNode) => {
            maxX = Math.max(maxX, node.x);
        });
        return maxX;
    }
}
