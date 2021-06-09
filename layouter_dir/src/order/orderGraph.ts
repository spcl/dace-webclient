import {DEBUG} from "../util/constants";
import * as _ from "lodash";
import Assert from "../util/assert";
import Component from "../graph/component";
import Edge from "../graph/edge";
import Graph from "../graph/graph";
import OrderGroup from "./orderGroup";
import OrderNode from "./orderNode";
import OrderRank from "./orderRank";
import Timer from "../util/timer";
import Shuffle from "../util/shuffle";

export default class OrderGraph {
    private _rankGraph: Graph<OrderRank, Edge<any, any>>;
    private _groupGraph: Graph<OrderGroup, Edge<any, any>>;
    private _nodeGraph: Graph<OrderNode, Edge<any, any>>;

    private _groupEdgesAdded: boolean = false;

    constructor() {
        this._rankGraph = new Graph<OrderRank, Edge<any, any>>();
        this._groupGraph = new Graph<OrderGroup, Edge<any, any>>();
        this._nodeGraph = new Graph<OrderNode, Edge<any, any>>();
    }

    toString(): string {
        const obj = {
            nodes: {},
            edges: [],
        };
        _.forEach(_.sortBy(this.groups(), "position"), (group: OrderGroup) => {
            obj.nodes[group.id] = {
                label: group.label(),
                child: {
                    nodes: {},
                    edges: [],
                },
            };
            _.forEach(group.orderedNodes(), (node: OrderNode) => {
                obj.nodes[group.id].child.nodes[node.id] = {
                    label: node.label(),
                    child: null
                };
            });
        });
        _.forEach(this.groupEdges(), (edge: Edge<any, any>) => {
            obj.edges.push({src: edge.src, dst: edge.dst, weight: edge.weight});
        });
        return JSON.stringify(obj);
    }

    public addRank(rank: OrderRank, id: number = null): number {
        rank.orderGraph = this;
        return this._rankGraph.addNode(rank, id);
    }

    public addGroup(group: OrderGroup, id: number = null): number {
        return this._groupGraph.addNode(group, id);
    }

    public addNode(node: OrderNode, id: number = null): number {
        return this._nodeGraph.addNode(node, id);
    }

    public removeNode(id: number): void {
        this._nodeGraph.removeNode(id);
    }

    public addEdge(edge: Edge<any, any>, id: number = null): number {
        return this._nodeGraph.addEdge(edge, id);
    }

    public removeEdge(id: number): void {
        this._nodeGraph.removeEdge(id);
    }

    private _addGroupEdges(): void {
        if (!this._groupEdgesAdded) {
            this._groupEdgesAdded = true;
            _.forEach(this._nodeGraph.edges(), (edge: Edge<any, any>) => {
                const srcGroupId = this._nodeGraph.node(edge.src).group.id;
                const dstGroupId = this._nodeGraph.node(edge.dst).group.id;
                const groupEdge = this._groupGraph.edgeBetween(srcGroupId, dstGroupId);
                if (groupEdge === undefined) {
                    this._groupGraph.addEdge(new Edge(srcGroupId, dstGroupId, edge.weight));
                } else {
                    groupEdge.weight += edge.weight;
                }
            });
        }
    }

    private _addRankEdges(): void {
        _.forEach(this._groupGraph.edges(), (edge: Edge<any, any>) => {
            const srcRankId = this._groupGraph.node(edge.src).rank.id;
            const dstRankId = this._groupGraph.node(edge.dst).rank.id;
            if (!this._rankGraph.hasEdge(srcRankId, dstRankId)) {
                this._rankGraph.addEdge(new Edge(srcRankId, dstRankId));
            }
        });
    }

    public node(id: number): OrderNode {
        return this._nodeGraph.node(id);
    }

    public group(id: number): OrderGroup {
        return this._groupGraph.node(id);
    }

    public nodes(): Array<OrderNode> {
        return this._nodeGraph.nodes();
    }

    public groups(): Array<OrderGroup> {
        return this._groupGraph.nodes();
    }

    public ranks(): Array<OrderRank> {
        return this._rankGraph.toposort();
    }

    public edges(): Array<Edge<any, any>> {
        return this._nodeGraph.edges();
    }

    public inEdges(id: number): Array<Edge<any, any>> {
        return this._nodeGraph.inEdges(id);
    }

    public outEdges(id: number): Array<Edge<any, any>> {
        return this._nodeGraph.outEdges(id);
    }

    public inNeighbors(id: number): Array<OrderNode> {
        return this._nodeGraph.inNeighbors(id);
    }

    public outNeighbors(id: number): Array<OrderNode> {
        return this._nodeGraph.outNeighbors(id);
    }

    public incidentEdges(id: number): Array<Edge<any, any>> {
        return this._nodeGraph.incidentEdges(id);
    }

    public edgeBetween(srcId: number, dstId: number): Edge<any, any> {
        return this._nodeGraph.edgeBetween(srcId, dstId);
    }

    public maxId(): number {
        return this._nodeGraph.maxId();
    }

    public groupEdges(): Array<Edge<any, any>> {
        this._addGroupEdges();
        return this._groupGraph.edges();
    }

    public order(options: object = {}): number {
        Timer.start(["doLayout", "orderRanks", "doOrder", "order"]);
        options = _.defaults(options, {
            debug: false,
            doNothing: false,
            orderGroups: false,
            countInitial: false,
            resolveConflicts: true,
            resolveY: "normal",
            shuffles: 0,
        });
        const doOrder = (graph: OrderGraph): number => {
            Timer.start(["doLayout", "orderRanks", "doOrder", "order", "doOrder"]);
            let minRank = Number.POSITIVE_INFINITY;
            const ranks = graph._rankGraph.toposort();
            const groupOffsetsN = []; // number of nodes in groups left of this group per rank (at start)
            const groupOffsetsPos = []; // number of nodes in groups left of this group per rank (reflecting current order)
            let groupOrder = []; // current order of groups on this level (e. g. 2, 0, 1)
            let groupPositions = [];// inverse of groupOrder (e. g. 1, 2, 0)
            let order = []; // current order of nodes on this level (e. g. 2, 0, 1)
            let positions = []; // inverse of order (e. g. 1, 2, 0)
            const neighborsDown = [];
            const weightsDown = [];
            const neighborsUp = [];
            const weightsUp = [];
            let crossings = []; // number of crossings above each rank

            const nodesPerRank = [];

            // set neighbors
            _.forEach(ranks, (rank: OrderRank, r: number) => {
                minRank = Math.min(minRank, rank.rank);
                groupOrder[r] = new Array(rank.groups.length);
                groupPositions[r] = new Array(rank.groups.length);
                groupOffsetsN[r] = [];
                groupOffsetsPos[r] = [];
                order[r] = [];
                positions[r] = [];
                neighborsDown[r] = [];
                weightsDown[r] = [];
                neighborsUp[r] = [];
                weightsUp[r] = [];
                crossings[r] = Number.POSITIVE_INFINITY;
                nodesPerRank[r] = [];

                let offset = 0;
                _.forEach(rank.groups, (group: OrderGroup) => {
                    groupOffsetsN[r][group.index] = offset;
                    offset += group.nodes.length;
                });
            });
            _.forEach(ranks, (rank: OrderRank, r: number) => {
                let offset = 0;
                _.forEach(rank.orderedGroups(), (group: OrderGroup, groupPos: number) => {
                    groupOffsetsPos[r][group.index] = offset;
                    offset += group.nodes.length;
                    groupOrder[r][groupPos] = group.index;
                    groupPositions[r][group.index] = groupPos;
                    _.forEach(group.orderedNodes(), (node: OrderNode, posInGroup: number) => {
                        node.rank = r;
                        const n = groupOffsetsN[r][group.index] + node.index;
                        const pos = groupOffsetsPos[r][group.index] + posInGroup;
                        order[r][pos] = n;
                        positions[r][n] = pos;
                        neighborsDown[r][n] = [];
                        weightsDown[r][n] = [];
                        neighborsUp[r][n] = [];
                        weightsUp[r][n] = [];
                        _.forEach(graph._nodeGraph.outEdges(node.id), (edge: Edge<any, any>) => {
                            neighborsDown[r][n].push(graph.node(edge.dst).index + groupOffsetsN[r + 1][graph.node(edge.dst).group.index]);
                            weightsDown[r][n].push(edge.weight);
                        });
                        _.forEach(graph._nodeGraph.inEdges(node.id), (edge: Edge<any, any>) => {
                            neighborsUp[r][n].push(graph.node(edge.src).index + groupOffsetsN[r - 1][graph.node(edge.src).group.index]);
                            weightsUp[r][n].push(edge.weight);
                        });
                    });
                });


                _.forEach(rank.groups, group => {
                    _.forEach(group.nodes, node => {
                        nodesPerRank[r].push(node);
                    });
                });

                if (DEBUG) {
                    assertOrderAndPositionCoherence();
                }
            });

            crossings[0] = 0;

            const countCrossings = (testOrder: Array<number>, r: number, direction: "UP" | "DOWN", preventConflicts: boolean = false) => {
                if (preventConflicts) {
                    const originalOrder = _.clone(order[r]);
                    order[r] = _.clone(testOrder);
                    _.forEach(order[r], (n, pos) => {
                        positions[r][n] = pos;
                    });
                    let hasConflict = false;
                    if (r > 0) {
                        hasConflict = hasConflict || (getConflict("HEAVYHEAVY", r) !== null) || (getConflict("HEAVYLIGHT", r) !== null);
                    }
                    if (r < ranks.length - 1) {
                        hasConflict = hasConflict || (getConflict("HEAVYHEAVY", r + 1) !== null) || (getConflict("HEAVYLIGHT", r + 1) !== null);
                    }
                    order[r] = _.clone(originalOrder);
                    _.forEach(order[r], (n, pos) => {
                        positions[r][n] = pos;
                    });
                    if (hasConflict) {
                        return Number.POSITIVE_INFINITY;
                    }
                }
                const edges = [];
                const neighbors = (direction === "UP" ? neighborsUp : neighborsDown);
                const weights = (direction === "UP" ? weightsUp : weightsDown);
                const neighborRank = (direction === "UP" ? (r - 1) : (r + 1));

                for (let pos = 0; pos < testOrder.length; ++pos) {
                    for (let neighbor = 0; neighbor < neighbors[r][testOrder[pos]].length; ++neighbor) {
                        let weight = weights[r][testOrder[pos]][neighbor];
                        if (weight === Number.POSITIVE_INFINITY) {
                            weight = 1;
                        }
                        edges.push([
                            pos,
                            positions[neighborRank][neighbors[r][testOrder[pos]][neighbor]],
                            weight,
                        ]);
                    }
                }
                return this._countCrossings(testOrder.length, order[neighborRank].length, edges);
            };

            /**
             * Sweeps the ranks up and down and reorders the nodes according to the barycenter heuristic
             * @param shuffle
             * @param shuffleNodes
             * @param startRank
             * @param preventConflicts
             */
            const reorder = (shuffle: boolean = false, shuffleNodes: boolean = false, startRank: number = 0, preventConflicts: boolean = false) => {
                Timer.start(["doLayout", "orderRanks", "doOrder", "order", "doOrder", "reorder"]);
                if (shuffle) {
                    _.forEach(ranks, (rank: OrderRank, r: number) => {
                        if (options["orderGroups"]) {
                            let maxLevel = _.maxBy(rank.groups, group => group.shuffleHierarchy.length).shuffleHierarchy.length - 1;
                            let deepOrder = _.clone(groupOrder[r]);
                            for (let level = maxLevel; level >= 0; --level) {
                                let nextDeepOrder = [];
                                let prevParent = undefined;
                                let sameParentSequence = [];
                                _.forEach(deepOrder, (gs: any) => {
                                    let g = gs;
                                    while (Array.isArray(g)) {
                                        g = g[0];
                                    }
                                    const parent = ranks[r].groups[g].shuffleHierarchy[level];
                                    if (parent === undefined) {
                                        nextDeepOrder.push(gs);
                                        return;
                                    }
                                    if (parent === prevParent) {
                                        sameParentSequence.push(gs);
                                    } else {
                                        if (prevParent !== undefined) {
                                            nextDeepOrder.push(Shuffle.shuffle(sameParentSequence));
                                        }
                                        sameParentSequence = [gs];
                                    }
                                    prevParent = parent;
                                });
                                nextDeepOrder.push(Shuffle.shuffle(sameParentSequence));
                                deepOrder = _.clone(nextDeepOrder);
                            }
                            groupOrder[r] = _.flattenDeep(deepOrder);
                            this._setGroupPositionAndOffset(groupOrder[r], groupPositions[r], groupOffsetsPos[r], ranks[r]);
                            order[r] = [];
                            _.forEach(groupOrder[r], (g: number) => {
                                let ns = _.range(rank.groups[g].nodes.length);
                                if (shuffleNodes) {
                                    ns = Shuffle.shuffle(ns);
                                }
                                _.forEach(ns, nInGroup => {
                                    order[r].push(groupOffsetsN[r][g] + nInGroup);
                                });
                            });
                            _.forEach(order[r], (n, pos) => {
                                positions[r][n] = pos;
                            });
                        } else {
                            _.forEach(rank.groups, (group: OrderGroup, g: number) => {
                                const groupOrder = Shuffle.shuffle(_.slice(order[r], groupOffsetsPos[r][g], groupOffsetsPos[r][g] + group.nodes.length));
                                _.forEach(groupOrder, (n, pos) => {
                                    order[r][groupOffsetsPos[r][g] + pos] = n;
                                    positions[r][n] = groupOffsetsPos[r][g] + pos;
                                });
                            });
                        }
                    });
                }

                if (DEBUG) {
                    // commented out: assert that nodes that belong to the same subgraph are contiguous
                    _.forEach(ranks, (rank, r) => {
                        for (let g1 = 0; g1 < rank.groups.length; ++g1) {
                            for (let g2 = g1 + 1; g2 < rank.groups.length; ++g2) {
                                for (let level = 1; level <= Math.min(rank.groups[g1].shuffleHierarchy.length, rank.groups[g1].shuffleHierarchy.length); ++level) {
                                    if (_.isEqual(_.slice(rank.groups[g1].shuffleHierarchy, 0, level), _.slice(rank.groups[g2].shuffleHierarchy, 0, level))) {
                                        for (let pos = Math.min(groupPositions[r][g1], groupPositions[r][g2]) + 1; pos < Math.max(groupPositions[r][g1], groupPositions[r][g2]); ++pos) {
                                            Assert.assertEqual(_.slice(rank.groups[g1].shuffleHierarchy, 0, level), _.slice(rank.groups[groupOrder[r][pos]].shuffleHierarchy, 0, level), "bad order " + pos);
                                        }
                                    }
                                }
                            }
                        }
                    });
                }

                let downward = true;
                let improveCounter = (!options["doNothing"] && (ranks.length > 1)) ? 2 : 0; // if only one rank, nothing to order
                while (improveCounter > 0) {
                    improveCounter--;
                    if (options["debug"]) {
                        console.log("TOTAL CROSSINGS", _.sum(crossings));
                    }
                    let firstRank = downward ? startRank + 1 : ranks.length - 2;
                    let lastRank = downward ? ranks.length - 1 : startRank;
                    const direction = downward ? 1 : -1;
                    const neighborsNorth = downward ? neighborsUp : neighborsDown;
                    const weightsNorth = downward ? weightsUp : weightsDown;
                    const crossingOffsetNorth = downward ? 0 : 1;
                    const crossingOffsetSouth = downward ? 1 : 0;
                    const northDirection = downward ? "UP" : "DOWN";
                    const southDirection = downward ? "DOWN" : "UP";
                    if (options["debug"]) {
                        console.log(downward ? "DOWN" : "UP");
                    }
                    for (let r = firstRank; r - direction !== lastRank; r += direction) {
                        if (DEBUG) {
                            assertOrderAndPositionCoherence(r);
                        }
                        if (options["debug"]) {
                            console.log("rank", r);
                        }

                        const northRank = r - direction;

                        if (crossings[r + crossingOffsetNorth] === 0) {
                            // no need to reorder
                            if (options["debug"]) {
                                console.log("skip because already 0");
                            }
                            continue;
                        }

                        const tryNewOrder = (newOrder) => {
                            // count crossings with new order
                            const prevCrossingsNorth = crossings[r + crossingOffsetNorth];
                            const newCrossingsNorth = countCrossings(newOrder, r, northDirection, preventConflicts);

                            let newCrossingsSouth = 0;
                            let prevCrossingsSouth = 0;
                            if (r !== lastRank) {
                                prevCrossingsSouth = crossings[r + crossingOffsetSouth];
                                newCrossingsSouth = countCrossings(newOrder, r, southDirection, preventConflicts);
                            }
                            const fewerCrossingsNorth = newCrossingsNorth < prevCrossingsNorth;
                            const fewerOrEqualCrossingsTotal = (newCrossingsNorth + newCrossingsSouth <= prevCrossingsNorth + prevCrossingsSouth);
                            if (fewerCrossingsNorth && fewerOrEqualCrossingsTotal) {
                                if (options["debug"]) {
                                    console.log("fewer crossings north", prevCrossingsNorth, "->", newCrossingsNorth, "south: ", prevCrossingsSouth, "->", newCrossingsSouth);
                                }
                                crossings[r + crossingOffsetNorth] = newCrossingsNorth;
                                if (r !== lastRank) {
                                    crossings[r + crossingOffsetSouth] = newCrossingsSouth;
                                }
                                order[r] = _.cloneDeep(newOrder);
                                _.forEach(order[r], (n: number, pos: number) => {
                                    positions[r][n] = pos;
                                });
                                const fewerCrossingsTotal = (newCrossingsNorth + newCrossingsSouth < prevCrossingsNorth + prevCrossingsSouth);
                                return (1 + (fewerCrossingsTotal ? 1 : 0));
                            } else {
                                if (options["debug"]) {
                                    console.log("not fewer crossings north", prevCrossingsNorth, "->", newCrossingsNorth, "south: ", prevCrossingsSouth, "->", newCrossingsSouth);
                                }
                                return 0;
                            }
                        };

                        let hasChanged = true;
                        while (hasChanged) {
                            hasChanged = false;
                            const newNodeOrder = new Array(order[r].length);
                            let groupMeans = [];
                            _.forEach(ranks[r].groups, (group: OrderGroup, g: number) => {
                                // calculate mean position of neighbors
                                let nodeMeans = [];
                                let groupSum = 0;
                                let groupNum = 0;
                                for (let pos = groupOffsetsPos[r][g]; pos < groupOffsetsPos[r][g] + group.nodes.length; ++pos) {
                                    const n = order[r][pos];
                                    let sum = 0;
                                    let num = 0;
                                    for (let neighbor = 0; neighbor < neighborsNorth[r][n].length; ++neighbor) {
                                        let weight = weightsNorth[r][n][neighbor];
                                        if (weight === Number.POSITIVE_INFINITY) {
                                            weight = 1;
                                        }
                                        const neighborPos = positions[northRank][neighborsNorth[r][n][neighbor]];
                                        sum += weight * neighborPos;
                                        num += weight;
                                    }
                                    if (neighborsNorth[r][n].length > 0) {
                                        nodeMeans.push([n, sum / num]);
                                    } else {
                                        nodeMeans.push([n, pos]);
                                    }
                                    groupSum += sum;
                                    groupNum += num;
                                }

                                // sort by the means
                                nodeMeans = _.sortBy(nodeMeans, pair => pair[1]);

                                for (let posInGroup = 0; posInGroup < group.nodes.length; ++posInGroup) {
                                    newNodeOrder[groupOffsetsPos[r][g] + posInGroup] = nodeMeans[posInGroup][0];
                                }

                                if (groupNum > 0) {
                                    groupMeans.push([g, groupSum / groupNum]);
                                } else {
                                    groupMeans.push([g, groupPositions[r][g]]);
                                }
                            });

                            // first reorder groups
                            if (options["orderGroups"]) {
                                const newGroupOrder = _.map(_.sortBy(groupMeans, "1"), "0");
                                _.forEach(this._getPartialOrders(newGroupOrder, groupOrder[r], groupPositions[r], options["debug"]), tmpGroupOrder => {
                                    // transform new group order to node order
                                    const tmpOrder = [];
                                    _.forEach(tmpGroupOrder, g => {
                                        for (let posInGroup = 0; posInGroup < ranks[r].groups[g].nodes.length; ++posInGroup) {
                                            tmpOrder.push(order[r][groupOffsetsPos[r][g] + posInGroup]);
                                        }
                                    });

                                    const result = tryNewOrder(tmpOrder);
                                    if (result > 0) {
                                        hasChanged = true;
                                        // store new group order
                                        groupOrder[r] = tmpGroupOrder;
                                        this._setGroupPositionAndOffset(groupOrder[r], groupPositions[r], groupOffsetsPos[r], ranks[r]);
                                    }
                                    if (result === 2) {
                                        improveCounter = 2;
                                    }
                                });
                            }

                            if (!hasChanged) {
                                // then reorder nodes
                                _.forEach(this._getPartialOrders(newNodeOrder, order[r], positions[r]), tmpOrder => {
                                    const result = tryNewOrder(tmpOrder);
                                    if (result > 0) {
                                        hasChanged = true;
                                    }
                                    if (result === 2) {
                                        improveCounter = 2;
                                    }
                                });
                            }
                        }
                        if (DEBUG) {
                            assertOrderAndPositionCoherence(r);
                        }
                    }
                    downward = !downward;
                }

                for (let r = 1; r < ranks.length; ++r) {
                    crossings[r] = countCrossings(order[r], r, "UP");
                }

                Timer.stop(["doLayout", "orderRanks", "doOrder", "order", "doOrder", "reorder"]);
            };

            const assertNeighborCoherence = (r: number = null) => {
                if (r === null) {
                    _.forEach(_.range(ranks.length), r => assertNeighborCoherence(r));
                    return;
                }
                _.forEach(neighborsDown[r], (neighborsPerNode, n) => {
                    Assert.assertAll(neighborsPerNode, neighbor => neighborsUp[r + 1][neighbor].indexOf(n) !== -1, "neighbor in rank " + (r + 1) + " is missing upNeighbor");
                });
                _.forEach(neighborsUp[r], (neighborsPerNode, n) => {
                    Assert.assertAll(neighborsPerNode, neighbor => neighborsDown[r - 1][neighbor].indexOf(n) !== -1, "neighbor in rank " + (r - 1) + "is missing downNeighbor");
                });
            }

            const assertOrderAndPositionCoherence = (r: number = null) => {
                if (r === null) {
                    _.forEach(_.range(ranks.length), r => assertOrderAndPositionCoherence(r));
                    return;
                }
                Assert.assertEqual(_.sortBy(order[r]), _.range(0, order[r].length), "order in rank " + r + " not contiguous");
                Assert.assertEqual(_.sortBy(positions[r]), _.range(0, order[r].length), "positions in rank " + r + " not contiguous");
                Assert.assertNone(positions[r], (pos, p) => order[r][pos] !== p, "positions and orders do not match");
                Assert.assertNone(order[r], (ord, o) => positions[r][ord] !== o, "positions and orders do not match");
            }

            const assertEdgesBetweenNeighboringRanks = () => {
                Assert.assertAll(this.edges(), edge => {
                    return this.node(edge.src).rank + 1 === this.node(edge.dst).rank;
                }, "edge not between neighboring ranks");
            }

            const getConflict = (type: "HEAVYHEAVY" | "HEAVYLIGHT", r: number, skipIfZero: boolean = false) => {
                if (skipIfZero && crossings[r] === 0) {
                    // there is no conflict in this rank
                    return null;
                }
                const segmentStarts = [];
                const segmentEnds = [];
                for (let n = 0; n < Math.max(order[r - 1].length); ++n) {
                    segmentStarts[n] = [];
                }
                for (let n = 0; n < Math.max(order[r].length); ++n) {
                    segmentEnds[n] = [];
                }
                for (let n = 0; n < order[r].length; ++n) {
                    const posSouth = positions[r][n];
                    for (let neighbor = 0; neighbor < neighborsUp[r][n].length; ++neighbor) {
                        const posNorth = positions[r - 1][neighborsUp[r][n][neighbor]];
                        const heavy = (weightsUp[r][n][neighbor] === Number.POSITIVE_INFINITY);
                        if (type === "HEAVYHEAVY" && !heavy) {
                            continue;
                        }
                        const intranode = (heavy && !ranks[r].groups[0].nodes[n].isVirtual);
                        if (type === "HEAVYLIGHT" && heavy && !intranode) {
                            continue;
                        }
                        const segment = [posNorth, posSouth, heavy];
                        segmentStarts[posNorth].push(segment);
                        segmentEnds[posSouth].push(segment);
                    }
                }
                const openSegments: Set<[number, number, boolean]> = new Set();
                for (let n = 0; n < Math.max(order[r].length, order[r - 1].length); ++n) {
                    _.forEach(segmentStarts[n], (segment: [number, number, boolean]) => {
                        const [posNorth, posSouth] = segment;
                        if (posNorth >= posSouth) {
                            openSegments.delete(segment);
                        }
                    });
                    _.forEach(segmentEnds[n], (segment: [number, number, boolean]) => {
                        const [posNorth, posSouth] = segment;
                        if (posNorth < posSouth) { // equality handled in loop above
                            openSegments.delete(segment);
                        }
                    });
                    const newSegments = [];
                    _.forEach(segmentStarts[n], (segment: [number, number, boolean]) => {
                        const [posNorth, posSouth] = segment;
                        if (posNorth <= posSouth) {
                            newSegments.push(segment);
                        }
                    });
                    _.forEach(segmentEnds[n], (segment: [number, number, boolean]) => {
                        const [posNorth, posSouth] = segment;
                        if (posNorth > posSouth) { // equality handled in loop above
                            newSegments.push(segment);
                        }
                    });
                    for (let newSegment of newSegments) {
                        const [posNorth, posSouth, heavy] = newSegment;
                        let newDir = Math.sign(posSouth - posNorth);
                        for (let openSegment of openSegments) {
                            const [openPosNorth, openPosSouth, openHeavy] = openSegment;
                            // dir is
                            let openDir = Math.sign(openPosSouth - openPosNorth);
                            if ((newDir !== openDir) || (newDir === 1 && posSouth < openPosSouth) || (posNorth < openPosNorth)) {
                                // segments have different direction or new segment is more vertical
                                if (openHeavy) {
                                    return [r, openPosNorth, openPosSouth, posNorth, posSouth];
                                } else if (heavy) {
                                    return [r, posNorth, posSouth, openPosNorth, openPosSouth];
                                }
                            }
                        }
                        if (newDir !== 0) {
                            openSegments.add(newSegment);
                        }
                    }
                }
                return null;
            }

            let step = 0;

            const storeLocal = () => {
                if (typeof window === "undefined") {
                    return;
                }
                step++;
                if (step === 1) {
                    const obj = [];
                    window.localStorage.setItem("orderGraph", JSON.stringify(obj));
                }
                const obj = JSON.parse(window.localStorage.getItem("orderGraph"));
                _.forEach(ranks, (rank: OrderRank, r: number) => {
                    _.forEach(rank.groups, (group: OrderGroup, g: number) => {
                        _.forEach(group.nodes, (node: OrderNode, n: number) => {
                            node.position = positions[r][groupOffsetsN[r][g] + n];
                        });
                        group.orderNodes();
                        group.position = groupPositions[r][g];
                    });
                    rank.orderGroups();
                });
                const stepObj = {ranks: [], edges: []};
                _.forEach(ranks, (rank: OrderRank) => {
                    const rankObj = [];
                    _.forEach(rank.orderedGroups(), (group: OrderGroup) => {
                        const groupObj = {label: group.label(), nodes: []};
                        _.forEach(group.orderedNodes(), (node: OrderNode) => {
                            groupObj.nodes.push({id: node.id, label: node.label(), isVirtual: node.isVirtual});
                        });
                        rankObj.push(groupObj);
                    });
                    stepObj.ranks.push(rankObj);
                });
                _.forEach(graph.edges(), edge => {
                    stepObj.edges.push({
                        src: edge.src,
                        dst: edge.dst,
                        weight: edge.weight === Number.POSITIVE_INFINITY ? "INFINITY" : edge.weight
                    });
                });
                obj.push(stepObj);
                window.localStorage.setItem("orderGraph", JSON.stringify(obj));
            };

            /**
             * Tries to resolve illegal crossings, i. e. crossings of edges with infinite weight.
             */
            const resolveConflicts = () => {
                if (DEBUG) {
                    Assert.assertAll(_.range(ranks.length), r => groupOrder[r].length === 1, "conflict resolution with more than one group per rank");
                }
                Timer.start(["doLayout", "orderRanks", "doOrder", "order", "doOrder", "resolve"]);
                const resolveConflict = (conflict) => {
                    const [r, crossedNorthPos, crossedSouthPos, crossingNorthPos, crossingSouthPos] = conflict;

                    const crossedNorthN = order[r - 1][crossedNorthPos];
                    const crossedNorthNode = ranks[r - 1].groups[0].nodes[crossedNorthN];
                    const crossedSouthN = order[r][crossedSouthPos];
                    const crossedSouthNode = ranks[r].groups[0].nodes[crossedSouthN];
                    const crossingNorthN = order[r - 1][crossingNorthPos];
                    let crossingNorthNode = ranks[r - 1].groups[0].nodes[crossingNorthN];
                    const crossingSouthN = order[r][crossingSouthPos];
                    let crossingSouthNode = ranks[r].groups[0].nodes[crossingSouthN];
                    const crossingEdge = graph.edgeBetween(crossingNorthNode.id, crossingSouthNode.id);

                    const resolveHeavyHeavy = () => {
                        if (options["debug"]) {
                            console.log("resolveHeavyHeavy");
                        }
                        const tmpOrderA = _.cloneDeep(order[r]);
                        _.pull(tmpOrderA, crossingSouthN);
                        tmpOrderA.splice(crossedSouthPos, 0, crossingSouthN);
                        const tmpOrderB = _.cloneDeep(order[r]);
                        _.pull(tmpOrderB, crossedSouthN);
                        tmpOrderB.splice(crossingSouthPos, 0, crossedSouthN);
                        let crossingsA = countCrossings(tmpOrderA, r, "UP");
                        let crossingsB = countCrossings(tmpOrderB, r, "UP");
                        if (r < ranks.length - 1) {
                            crossingsA += countCrossings(tmpOrderA, r, "DOWN");
                            crossingsB += countCrossings(tmpOrderB, r, "DOWN");
                        }
                        if (crossingsA < crossingsB) {
                            order[r] = tmpOrderA;
                        } else {
                            order[r] = tmpOrderB;
                        }
                        // update positions
                        _.forEach(order[r], (n, pos) => {
                            positions[r][n] = pos;
                        });
                        // update number of crossings
                        for (let tmpR = r; tmpR <= Math.min(r + 1, ranks.length - 1); ++tmpR) {
                            crossings[tmpR] = countCrossings(order[tmpR], tmpR, "UP");
                        }
                    };

                    const resolveY = () => {
                        if (options["debug"]) {
                            console.log("resolveY");
                        }
                        const addEdge = (srcNode: OrderNode, dstNode: OrderNode, weight: number) => {
                            if (srcNode.isVirtual && dstNode.isVirtual) {
                                weight = Number.POSITIVE_INFINITY;
                            }
                            const newEdge = new Edge(srcNode.id, dstNode.id, weight);
                            const newEdgeId = this.addEdge(newEdge);
                            graph.addEdge(newEdge, newEdgeId);
                        };

                        const removeEdge = (srcNode: OrderNode, dstNode: OrderNode) => {
                            const edge = graph.edgeBetween(srcNode.id, dstNode.id);
                            graph.removeEdge(edge.id);
                            this.removeEdge(edge.id);
                        };

                        const addNode = (r: number, pos: number, node: OrderNode) => {
                            const nextN = order[r].length;
                            for (let tmpPos = order[r].length; tmpPos >= pos + 1; --tmpPos) {
                                order[r][tmpPos] = order[r][tmpPos - 1];
                            }
                            order[r][pos] = nextN;
                            ranks[r].groups[0].addNode(node, node.id);
                            node.rank = r;
                            node.index = nextN;
                            // update positions
                            _.forEach(order[r], (n, pos) => {
                                positions[r][n] = pos;
                            });

                            return nextN;
                        };

                        const removeNode = (node: OrderNode, permanent: boolean = false) => {
                            const r = node.rank;
                            const n = node.index;
                            const pos = positions[r][n];

                            // adjust n's
                            for (let tmpN = n + 1; tmpN < order[r].length; ++tmpN) {
                                order[r][positions[r][tmpN]]--;
                            }
                            ranks[r].groups[0].removeNode(node);

                            // adjust positions
                            for (let tmpPos = pos + 1; tmpPos < order[r].length; ++tmpPos) {
                                order[r][tmpPos - 1] = order[r][tmpPos];
                            }

                            order[r].length = order[r].length - 1;
                            positions[r].length = order[r].length;

                            // update positions
                            _.forEach(order[r], (n, pos) => {
                                positions[r][n] = pos;
                            });

                            if (permanent) {
                                graph.removeNode(node.id);
                                this.removeNode(node.id);
                            }
                        };

                        // mark nodes that must not be moved
                        const nonMoving = new Set();
                        const intranodePathEnds = new Set();
                        const sinks = new Set();
                        _.forEach(ranks[r - 1].groups[0].nodes, (node: OrderNode) => {
                            let isOnIntranodePath = !node.isVirtual && _.some(graph.incidentEdges(node.id), edge => edge.weight === Number.POSITIVE_INFINITY);
                            _.forEach(graph.incidentEdges(node.id), edge => {
                                if (edge.weight === Number.POSITIVE_INFINITY) {
                                    isOnIntranodePath = !node.isVirtual;
                                }
                            });
                            if (isOnIntranodePath) {
                                nonMoving.add(node);
                                let tmpNode = node;
                                while (graph.outEdges(tmpNode.id).length > 0 && graph.outEdges(tmpNode.id)[0].weight === Number.POSITIVE_INFINITY) {
                                    tmpNode = graph.node(graph.outEdges(tmpNode.id)[0].dst);
                                    nonMoving.add(tmpNode);
                                }
                                intranodePathEnds.add(tmpNode);
                            } else if (graph.outEdges(node.id).length === 0) {
                                // sink on rank r - 1
                                nonMoving.add(node);
                                sinks.add(node);
                            }
                        });

                        // create new rank if necessary
                        if (_.filter(_.last(ranks).groups[0].nodes, node => !nonMoving.has(node)).length > 0) {
                            const newR = ranks.length;
                            const newRank = new OrderRank(ranks[ranks.length - 1].rank + 1);
                            this.addRank(newRank);
                            const newGroup = new OrderGroup(null);
                            newRank.addGroup(newGroup);
                            const newRankComponent = new OrderRank(ranks[ranks.length - 1].rank + 1);
                            graph.addRank(newRankComponent);
                            ranks.push(newRankComponent);
                            newRankComponent.addGroup(newGroup);
                            this._groupGraph.addEdge(new Edge(ranks[newR - 1].groups[0].id, ranks[newR].groups[0].id));
                            this._rankGraph.addEdge(new Edge(ranks[newR - 1].id, ranks[newR].id));
                            newRankComponent.order = [0];
                            groupOrder[newR] = [0];
                            groupPositions[newR] = [0];
                            groupOffsetsPos[newR] = [0];
                            groupOffsetsN[newR] = [0];
                            order[newR] = [];
                            positions[newR] = [];
                            crossings[newR] = 0;
                        }

                        // move nodes down and create virtual nodes
                        for (let tmpR = ranks.length - 1; tmpR >= r; --tmpR) {
                            const northNodes = _.map(order[tmpR - 1], n => ranks[tmpR - 1].groups[0].nodes[n]);
                            _.forEach(northNodes, (node: OrderNode) => {
                                if (!nonMoving.has(node)) {
                                    const pos = positions[tmpR - 1][node.index];
                                    removeNode(node);
                                    addNode(tmpR, order[tmpR].length, node);
                                    if (tmpR === r) {
                                        // create a virtual node for each in edge and route edge through new node
                                        const sortedEdges = _.sortBy(graph.inEdges(node.id), edge => positions[r - 2][graph.node(edge.src).index]);
                                        _.forEachRight(sortedEdges, inEdge => {
                                            const newNode = new OrderNode(null, true, node.label() + "'");
                                            this.addNode(newNode);
                                            addNode(r - 1, pos, newNode);
                                            const srcNode = graph.node(inEdge.src);
                                            removeEdge(srcNode, node);
                                            addEdge(srcNode, newNode, inEdge.weight);
                                            addEdge(newNode, node, inEdge.weight);
                                        });
                                    }
                                } else {
                                    if (intranodePathEnds.has(node)) {
                                        if (DEBUG) {
                                            Assert.assertAll(graph.outEdges(node.id), edge => graph.node(edge.dst).rank === tmpR + 1, "edge below intranode path end not spanning two ranks");
                                        }
                                        // create a virtual node for each out edge and route edge through new node
                                        // sort edges to prevent crossings between them
                                        const sortedEdges = _.sortBy(graph.outEdges(node.id), edge => positions[tmpR + 1][graph.node(edge.dst).index]);
                                        _.forEach(sortedEdges, outEdge => {
                                            const newNode = new OrderNode(null, true, node.label() + "'");
                                            this.addNode(newNode);
                                            addNode(tmpR, order[tmpR].length, newNode);
                                            const dstNode = graph.node(outEdge.dst);
                                            removeEdge(node, dstNode);
                                            addEdge(node, newNode, outEdge.weight);
                                            addEdge(newNode, dstNode, outEdge.weight);
                                        });
                                    } else if (!sinks.has(node)) {
                                        // there is a an internode segment between upper and this rank
                                        // => change order within this rank
                                        const lowerNode = graph.outNeighbors(node.id)[0];
                                        removeNode(lowerNode);
                                        addNode(tmpR, order[tmpR].length, lowerNode);
                                    }
                                }
                            });
                        }

                        if (options["debug"]) {
                            storeLocal();
                        }

                        // recreate neighbors data structure
                        for (let tmpR = 0; tmpR < ranks.length; ++tmpR) {
                            neighborsDown[tmpR] = [];
                            weightsDown[tmpR] = [];
                            neighborsUp[tmpR] = [];
                            weightsUp[tmpR] = [];
                            _.forEach(ranks[tmpR].groups[0].nodes, (node: OrderNode, n: number) => {
                                neighborsDown[tmpR][n] = [];
                                weightsDown[tmpR][n] = [];
                                neighborsUp[tmpR][n] = [];
                                weightsUp[tmpR][n] = [];
                            });
                        }
                        _.forEach(graph.edges(), edge => {
                            const srcNode = graph.node(edge.src);
                            const dstNode = graph.node(edge.dst);
                            neighborsDown[srcNode.rank][srcNode.index].push(dstNode.index);
                            weightsDown[srcNode.rank][srcNode.index].push(edge.weight);
                            neighborsUp[dstNode.rank][dstNode.index].push(srcNode.index);
                            weightsUp[dstNode.rank][dstNode.index].push(edge.weight);
                        });

                        for (let tmpR = 1; tmpR < ranks.length; ++tmpR) {
                            crossings[tmpR] = countCrossings(order[tmpR], tmpR, "UP");
                        }
                        if (DEBUG) {
                            Assert.assertAll(_.range(r + 1), r => getConflict("HEAVYHEAVY", r, true) === null, "heavy-heavy conflict after y resolution");
                        }
                    }

                    const checkXResolution = (side: "LEFT" | "RIGHT") => {
                        const nodesPerRank = new Array(ranks.length);
                        const minHeavyNodePerRank: Array<number> = new Array(ranks.length);
                        const maxOtherNodePerRank: Array<number> = new Array(ranks.length);
                        let conflict = false;
                        for (let r = 0; r < ranks.length; ++r) {
                            nodesPerRank[r] = new Map();
                            minHeavyNodePerRank[r] = (side === "RIGHT" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
                            maxOtherNodePerRank[r] = (side === "RIGHT" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY);
                        }
                        const queue: Array<[OrderNode, string]> = [];
                        let minRank = r - 1;
                        let maxRank = r;
                        const moveDir = (side === "LEFT" ? 1 : -1);
                        const minFun = (side === "RIGHT" ? Math.min : Math.max);
                        const maxFun = (side === "RIGHT" ? Math.max : Math.min);
                        const geFun = (side === "RIGHT" ? ((a, b) => a >= b) : ((a, b) => a <= b));
                        const addNodeToGroup = (r: number, node: OrderNode, group: string) => {
                            nodesPerRank[r].set(node, group);
                            queue.push([node, group]);
                            const addIntermediate = () => {
                                if (geFun(maxOtherNodePerRank[r], minHeavyNodePerRank[r])) {
                                    const intermediate = [];
                                    for (let pos = maxOtherNodePerRank[r]; pos !== minHeavyNodePerRank[r]; pos += moveDir) {
                                        const node = ranks[r].groups[0].nodes[order[r][pos]];
                                        if (!nodesPerRank[r].has(node)) {
                                            intermediate.push([node, "YELLOW"]);
                                        } else if (node.rank === minRank) {
                                            intermediate.push([node, nodesPerRank[r].get(node)]); // check boundaries again
                                        }
                                    }
                                    _.forEach(intermediate, ([node, group]) => {
                                        addNodeToGroup(r, node, group);
                                    });
                                }
                            }
                            if (group === "RED") {
                                const prev = maxOtherNodePerRank[r];
                                maxOtherNodePerRank[r] = maxFun(maxOtherNodePerRank[r], positions[r][node.index]);
                                if (maxOtherNodePerRank[r] !== prev && minHeavyNodePerRank[r] !== Number.POSITIVE_INFINITY && minHeavyNodePerRank[r] !== Number.NEGATIVE_INFINITY) {
                                    addIntermediate();
                                }
                            } else {
                                // potentially heavy
                                const prev = minHeavyNodePerRank[r];
                                minHeavyNodePerRank[r] = minFun(minHeavyNodePerRank[r], positions[r][node.index]);
                                if (minHeavyNodePerRank[r] !== prev && maxOtherNodePerRank[r] !== Number.POSITIVE_INFINITY && maxOtherNodePerRank[r] !== Number.NEGATIVE_INFINITY) {
                                    addIntermediate();
                                }
                            }
                        };
                        addNodeToGroup(r - 1, crossedNorthNode, "GREEN");
                        addNodeToGroup(r, crossedSouthNode, "GREEN");
                        addNodeToGroup(r - 1, crossingNorthNode, "RED");
                        addNodeToGroup(r, crossingSouthNode, "RED");

                        let queuePointer = 0;
                        while (queuePointer < queue.length && !conflict) {
                            const [node, group] = queue[queuePointer++];
                            if (nodesPerRank[node.rank].get(node) !== group) {
                                continue; // group has changed in the meantime
                            }
                            const addNeighbors = (neighborMethod: "inEdges" | "outEdges", neighborProperty: "src" | "dst", rankOffset: 1 | -1) => {
                                _.forEach(graph[neighborMethod](node.id), edge => {
                                    if (edge === crossingEdge) {
                                        return;
                                    }
                                    const neighborRank = node.rank + rankOffset;
                                    const neighbor = graph.node(edge[neighborProperty]);
                                    if (!nodesPerRank[neighborRank].has(neighbor)) {
                                        // add neighbor to same group as this node
                                        addNodeToGroup(neighborRank, neighbor, group);
                                    } else {
                                        // check for conflict or group change
                                        const neighborGroup = nodesPerRank[neighborRank].get(neighbor);
                                        if (neighborGroup !== group) {
                                            if (neighborGroup === "YELLOW") {
                                                addNodeToGroup(neighborRank, neighbor, group);
                                            } else if (group === "YELLOW") {
                                                addNodeToGroup(node.rank, node, neighborGroup);
                                            } else {
                                                // one is "GREEN" and the other is "RED"
                                                conflict = true;
                                            }
                                        }
                                    }
                                });
                            };
                            if (node.rank > minRank) {
                                addNeighbors("inEdges", "src", -1);
                            }
                            if (node.rank === minRank && geFun(positions[node.rank][node.index], minHeavyNodePerRank[node.rank])) {
                                let foundNewMinRank = false;
                                _.forEach(graph.inEdges(node.id), inEdge => {
                                    if (inEdge.weight === Number.POSITIVE_INFINITY) {
                                        foundNewMinRank = true;
                                    }
                                });
                                if (foundNewMinRank) {
                                    minRank--;
                                    nodesPerRank[node.rank].forEach((group, borderNode) => {
                                        queue.push([borderNode, group]);
                                    });
                                }
                            }
                            if (node.rank < maxRank) {
                                addNeighbors("outEdges", "dst", 1);
                            }
                        }
                        if (conflict) {
                            return null;
                        }
                        // group nodes
                        const nodesPerRankGrouped = [];
                        _.forEach(nodesPerRank, (nodes, r) => {
                            nodesPerRankGrouped[r] = {
                                "GREEN": new Set(),
                                "MOVING": new Set(),
                            };
                            minHeavyNodePerRank[r] = (side === "RIGHT" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
                            nodes.forEach((group, node) => {
                                if (group !== "RED") {
                                    // "GREEN" or "YELLOW"
                                    // because we want to move as few nodes as possible, we count the "YELLOW" nodes to the "GREEN" nodes
                                    nodesPerRankGrouped[r]["GREEN"].add(node);
                                    minHeavyNodePerRank[r] = minFun(minHeavyNodePerRank[r], positions[r][node.index]);
                                }
                            });
                            nodes.forEach((group, node) => {
                                if (group === "RED" && geFun(positions[r][node.index], minHeavyNodePerRank[node.rank])) {
                                    nodesPerRankGrouped[r]["MOVING"].add(node);
                                }
                            });
                        });
                        return nodesPerRankGrouped;
                    };

                    const resolveX = (side: "LEFT" | "RIGHT", nodesPerRank) => {
                        if (options["debug"]) {
                            console.log("resolveX", side, nodesPerRank);
                        }
                        let minChangedRank = Number.POSITIVE_INFINITY;
                        let maxChangedRank = Number.NEGATIVE_INFINITY;
                        _.forEach(nodesPerRank, (rank, r: number) => {
                            if (rank["MOVING"].size === 0 || rank["GREEN"].size === 0) {
                                return;
                            }
                            const heavy: Array<OrderNode> = _.sortBy(Array.from(rank["GREEN"]), node => positions[r][node.index]);
                            const moving: Array<OrderNode> = _.sortBy(Array.from(rank["MOVING"]), node => positions[r][node.index]);
                            const newOrder = [];
                            _.forEach(order[r], n => {
                                const node = ranks[r].groups[0].nodes[n];
                                if (rank["MOVING"].has(node)) {
                                    return; // do nothing
                                }
                                if (side === "RIGHT" && n === heavy[0].index) {
                                    _.forEach(moving, movingNode => {
                                        newOrder.push(movingNode.index);
                                    });
                                }
                                newOrder.push(n);
                                if (side === "LEFT" && n === _.last(heavy).index) {
                                    _.forEach(moving, movingNode => {
                                        newOrder.push(movingNode.index);
                                    });
                                }
                            });
                            order[r] = newOrder;
                            _.forEach(order[r], (n, pos) => {
                                positions[r][n] = pos;
                            });
                            minChangedRank = Math.min(minChangedRank, r);
                            maxChangedRank = Math.max(maxChangedRank, r + 1);
                        });
                        for (let r = minChangedRank; r <= Math.min(maxChangedRank, ranks.length - 1); ++r) {
                            crossings[r] = countCrossings(order[r], r, "UP");
                        }

                        if (options["debug"]) {
                            storeLocal();
                        }
                        if (DEBUG) {
                            Assert.assertAll(_.range(r + 1), r => getConflict("HEAVYHEAVY", r, true) === null, "heavy-heavy conflict after x resolution");
                        }
                    };

                    if (crossingEdge.weight === Number.POSITIVE_INFINITY) {
                        resolveHeavyHeavy();
                    } else {
                        const leftResolution = checkXResolution("LEFT");
                        const rightResolution = checkXResolution("RIGHT");
                        if (leftResolution === null) {
                            if (rightResolution === null) {
                                resolveY();
                            } else {
                                resolveX("RIGHT", rightResolution);
                            }
                        } else {
                            if (rightResolution === null) {
                                resolveX("LEFT", leftResolution);
                            } else {
                                const numNodesLeft = _.sum(_.map(leftResolution, rank => rank["MOVING"].size));
                                const numNodesRight = _.sum(_.map(rightResolution, rank => rank["MOVING"].size));
                                if (numNodesLeft < numNodesRight) {
                                    resolveX("LEFT", leftResolution);
                                } else {
                                    resolveX("RIGHT", rightResolution);
                                }
                            }
                        }
                    }
                }

                if (options["debug"]) {
                    storeLocal();
                }

                for (let r = 1; r < ranks.length; ++r) {
                    crossings[r] = countCrossings(order[r], r, "UP");
                }
                for (let r = 1; r < ranks.length; ++r) {
                    while (getConflict("HEAVYHEAVY", r, true) !== null) {
                        const conflict = getConflict("HEAVYHEAVY", r);
                        resolveConflict(conflict);
                        if (options["debug"]) {
                            storeLocal();
                        }
                    }
                    while (getConflict("HEAVYLIGHT", r, true) !== null) {
                        const conflict = getConflict("HEAVYLIGHT", r);
                        resolveConflict(conflict);
                        if (options["debug"]) {
                            storeLocal();
                        }
                    }
                }
                if (DEBUG) {
                    Assert.assertAll(_.range(1, ranks.length), r => getConflict("HEAVYHEAVY", r) === null, "heavy-heavy conflict after y resolution");
                }

                Timer.stop(["doLayout", "orderRanks", "doOrder", "order", "doOrder", "resolve"]);
            }

            if (options["debug"]) {
                storeLocal();
            }

            if (options["countInitial"]) {
                for (let r = 1; r < ranks.length; ++r) {
                    crossings[r] = countCrossings(order[r], r, "UP");
                }
            }
            if (options["shuffles"] === 0) {
                reorder();
            } else {
                const originalOrder = _.cloneDeep(order);
                const originalGroupOrder = _.cloneDeep(groupOrder);
                const originalCrossings = _.cloneDeep(crossings);
                reorder();
                let numCrossings = _.sum(crossings);
                let minCrossings = numCrossings;
                let bestOrder = _.cloneDeep(order);
                let bestGroupOrder = _.cloneDeep(groupOrder);
                for (let i = 0; i < options["shuffles"]; ++i) {
                    if (minCrossings === 0) {
                        break;
                    }
                    _.forEach(ranks, (rank: OrderRank, r: number) => {
                        _.forEach(originalOrder[r], (n: number, pos: number) => {
                            order[r][pos] = n;
                            positions[r][n] = pos;
                        });
                        groupOrder[r] = _.clone(originalGroupOrder[r]);
                        this._setGroupPositionAndOffset(groupOrder[r], groupPositions[r], groupOffsetsPos[r], rank);
                    });
                    crossings = _.cloneDeep(originalCrossings);
                    reorder(true, true);
                    numCrossings = _.sum(crossings);
                    if (numCrossings < minCrossings) {
                        minCrossings = numCrossings;
                        bestOrder = _.cloneDeep(order);
                        bestGroupOrder = _.cloneDeep(groupOrder);
                    }
                }
                for (let r = 0; r < ranks.length; ++r) {
                    _.forEach(bestOrder[r], (g, pos) => {
                        order[r][pos] = g;
                        positions[r][g] = pos;
                    });
                    _.forEach(bestGroupOrder[r], (g, pos) => {
                        groupOrder[r][pos] = g;
                        groupPositions[r][g] = pos;
                    });
                }
            }

            if (options["resolveConflicts"]) {
                resolveConflicts();
                reorder(false, false, 0, true);
            }

            // transform component ranks to absolute ranks
            if (minRank > 0 && minRank < Number.POSITIVE_INFINITY) {
                _.forEach(graph.nodes(), (node: OrderNode) => {
                    node.rank += minRank;
                });
            }

            // store new positions
            _.forEach(ranks, (rank: OrderRank, r: number) => {
                _.forEach(rank.groups, (group: OrderGroup, g: number) => {
                    group.position = groupPositions[r][g];
                    _.forEach(group.nodes, (node: OrderNode) => {
                        node.position = positions[r][groupOffsetsN[r][g] + node.index];
                    });
                    group.orderNodes();
                });
                rank.orderGroups();
            });

            const numCrossings = _.sum(crossings);

            Timer.stop(["doLayout", "orderRanks", "doOrder", "order", "doOrder"]);

            return numCrossings;
        }

        this._addGroupEdges();

        let numCrossings = 0;
        const groupComponents = this._groupGraph.components();
        _.forEach(groupComponents, (groupGraphComponent: Component<OrderGroup, Edge<any, any>>) => {
            const componentGraph = new OrderGraph();
            const ranks: Array<OrderRank> = [];
            _.forEach(groupGraphComponent.nodes(), (group: OrderGroup) => {
                if (ranks[group.rank.id] === undefined) {
                    ranks[group.rank.id] = new OrderRank(group.rank.rank);
                    componentGraph.addRank(ranks[group.rank.id]);
                }
                ranks[group.rank.id].addGroup(group, group.id);
                const groupNodes = group.nodes;
                group.nodes = [];
                _.forEach(groupNodes, (node: OrderNode) => {
                    group.addNode(node, node.id);
                });
            });

            _.forEach(componentGraph.nodes(), (newNode: OrderNode) => {
                _.forEach(this.outEdges(newNode.id), (edge: Edge<any, any>) => {
                    componentGraph.addEdge(edge, edge.id);
                });
            });

            if (componentGraph._nodeGraph.numEdges() < 2) {
                // with 0 or one edges, there is nothing to reorder
                return;
            }

            componentGraph._addGroupEdges();
            componentGraph._addRankEdges();

            numCrossings += doOrder(componentGraph);
        });
        Timer.stop(["doLayout", "orderRanks", "doOrder", "order"]);

        return numCrossings;
    }

    /**
     * Adapted from Barth, W., Jünger, M., & Mutzel, P. (2002, August). Simple and efficient bilayer cross counting.
     * In International Symposium on Graph Drawing (pp. 130-141). Springer, Berlin, Heidelberg.
     * @param numNorth
     * @param numSouth
     * @param edges
     * @private
     */
    private _countCrossings(numNorth: number, numSouth: number, edges: Array<[number, number, number]>): number {
        // build south sequence
        const sortedEdges = _.sortBy(edges, edge => edge[0] * numSouth + edge[1]);
        const southSequence = _.map(sortedEdges, edge => edge[1]);
        const weights = _.map(sortedEdges, edge => edge[2]);

        // build the accumulator tree
        let firstIndex = 1;
        while (firstIndex < numSouth) {
            firstIndex *= 2; // number of tree nodes
        }
        const treeSize = 2 * firstIndex - 1;
        firstIndex -= 1; // index of leftmost leaf
        const tree = _.fill(new Array(treeSize), 0);

        // compute the total weight of the crossings
        let crossWeight = 0;
        _.forEach(southSequence, (south: number, i: number) => {
            let index = south + firstIndex;
            tree[index] += weights[i];
            let weightSum = 0;
            while (index > 0) {
                if (index % 2) {
                    weightSum += tree[index + 1];
                }
                index = Math.floor((index - 1) / 2);
                tree[index] += weights[i];
            }
            crossWeight += weights[i] * weightSum;
        });
        return crossWeight;
    }

    private _getPartialOrders(newOrder: Array<number>, order: Array<number>, positions: Array<number>, debug: boolean = false): Array<Array<number>> {
        const changes = [];
        const permutation = new Array(newOrder.length);
        _.forEach(newOrder, (index, pos) => {
            permutation[pos] = positions[index];
        });
        let seqStart = null;
        let seqEnd = -1;
        for (let pos = 0; pos < permutation.length; ++pos) {
            if (permutation[pos] > pos) {
                if (seqStart === null) {
                    seqStart = pos;
                    seqEnd = permutation[pos];
                } else {
                    if (seqEnd < pos) {
                        changes.push([seqStart, pos - 1]);
                        seqStart = pos;
                        seqEnd = permutation[pos];
                    } else {
                        seqEnd = Math.max(seqEnd, permutation[pos]);
                    }
                }
            }
            if (permutation[pos] === pos && seqStart !== null && seqEnd < pos) {
                changes.push([seqStart, pos - 1]);
                seqStart = null;
            }
        }
        if (seqStart !== null) {
            changes.push([seqStart, permutation.length - 1]);
        }
        const tmpOrders = [];
        _.forEach(changes, change => {
            tmpOrders.push(_.concat(
                _.slice(order, 0, change[0]),
                _.slice(newOrder, change[0], change[1] + 1),
                _.slice(order, change[1] + 1)
            ));
        })
        return tmpOrders;
    }

    private _setGroupPositionAndOffset(groupOrder: Array<number>, groupPositions: Array<number>, groupOffsetsPos: Array<number>, rank: OrderRank): void {
        let offset = 0;
        _.forEach(groupOrder, (g: number, pos: number) => {
            groupPositions[g] = pos;
            groupOffsetsPos[g] = offset;
            offset += rank.groups[g].nodes.length;
        });
    }
}
