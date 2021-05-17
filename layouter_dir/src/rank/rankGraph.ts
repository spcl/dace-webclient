import {DEBUG} from "../util/constants";
import * as _ from "lodash";
import Assert from "../util/assert";
import Component from "../graph/component";
import Edge from "../graph/edge";
import Graph from "../graph/graph";
import RankNode from "./rankNode";

export default class RankGraph extends Graph<RankNode, Edge<any, any>> {
    rank(): void {
        if (DEBUG) {
            Assert.assert(this.components().length === 1, "rank graph has more than one component");
            Assert.assert(!this.hasCycle(), "rank graph has cycle");
        }

        // do toposort and allocate each node with one of its ancestor sources
        const rankPerNode: Array<Map<number, number>> = new Array(this.maxId() + 1);
        for (let n = 0; n < rankPerNode.length; ++n) {
            rankPerNode[n] = new Map();
        }
        const sources = this.sources();
        let s = 0;
        let source = sources[0];
        const unrankedNeighbors = new Set();
        while (s < sources.length) {
            let minDiff = (s === 0 ? 0 : Number.POSITIVE_INFINITY);

            const sourceComponent = new Component(this);

            // bfs starting at source
            const visited = _.fill(new Array(this.maxId() + 1), false);
            const wasRankedBefore = _.fill(new Array(this.maxId() + 1), false);
            let queue = [];
            let queuePointer = 0;
            queue.push(source);
            visited[source.id] = true;
            while (queuePointer < queue.length) {
                const node = queue[queuePointer++];
                sourceComponent.addNode(node.id);
                if (node.rank === null) {
                    _.forEach(this.outEdges(node.id), outEdge => {
                        if (!visited[outEdge.dst]) {
                            queue.push(this.node(outEdge.dst));
                            visited[outEdge.dst] = true;
                        }
                    });
                } else {
                    wasRankedBefore[node.id] = true;
                }
            }

            if (DEBUG) {
                Assert.assertImplies(s > 0, _.some(sourceComponent.nodes(), node => node.rank !== null), "no common sink");
            }

            sourceComponent.induceEdges();

            const rankPerNode = _.fill(new Array(this.maxId() + 1), 0);
            _.forEach(sourceComponent.toposort(), (node: RankNode) => {
                if (node.rank !== null) {
                    minDiff = Math.min(minDiff, node.rank - rankPerNode[node.id]);
                } else {
                    node.rank = rankPerNode[node.id];
                    _.forEach(this.outEdges(node.id), outEdge => {
                        let nextRank = node.rank + outEdge.weight;
                        if (outEdge.weight === Infinity) {
                            throw new Error("INFINITE WQEIGHT");
                        }
                        rankPerNode[outEdge.dst] = Math.max(rankPerNode[outEdge.dst], nextRank);
                    });
                }
            });

            if (DEBUG) {
                Assert.assert(minDiff !== Number.POSITIVE_INFINITY, "minDiff is infinity", sourceComponent);
            }

            _.forEach(sourceComponent.nodes(), (node: RankNode) => {
                if (!wasRankedBefore[node.id]) {
                    node.rank += minDiff;
                }
            });

            s++;
            if (s < sources.length) {
                // update unranked neighbors
                _.forEach(sourceComponent.nodes(), (node: RankNode) => {
                    unrankedNeighbors.delete(node);
                    _.forEach(this.inEdges(node.id), inEdge => {
                        const neighbor = this.node(inEdge.src)
                        if (neighbor.rank === null) {
                            unrankedNeighbors.add(neighbor);
                        }
                    });
                });
                // bfs from an arbitrary unranked neighbor upwards to find "connected" source
                let queue = [];
                let queuePointer = 0;
                const visited = _.fill(new Array(this.maxId() + 1), false);
                const upwardSource = unrankedNeighbors.keys().next().value; // first unranked neighbor
                visited[upwardSource.id] = true;
                queue.push(upwardSource);
                while (queuePointer < queue.length) {
                    const node = queue[queuePointer++];
                    const inEdges = this.inEdges(node.id);
                    if (inEdges.length === 0) {
                        source = node;
                        break;
                    } else {
                        _.forEach(inEdges, inEdge => {
                            if (!visited[inEdge.src]) {
                                queue.push(this.node(inEdge.src));
                                visited[inEdge.src] = true;
                            }
                        });
                    }
                }
            }
            if (DEBUG) {
                Assert.assertImplies(s < sources.length, source.rank === null, "no new source found");
            }
        }

        let minRank = Number.POSITIVE_INFINITY;
        _.forEach(this.nodes(), (node: RankNode) => {
            if (node.rank === Number.POSITIVE_INFINITY) {
                throw new Error("I AM DUMB");
            }
            if (DEBUG) {
                Assert.assertNumber(node.rank, "rank is not a valid number");
            }
            minRank = Math.min(minRank, node.rank);
        });
        const difference = 0 - minRank;
        _.forEach(this.nodes(), (node) => {
            node.rank += difference;
        });
    }
}
