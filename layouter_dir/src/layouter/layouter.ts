import {CONNECTOR_SIZE, CONNECTOR_SPACING, DEBUG} from "../util/constants";
import * as _ from "lodash";
import * as seedrandom from "seedrandom";
import Assert from "../util/assert";
import Component from "../graph/component";
import LayoutBundle from "../layoutGraph/layoutBundle";
import LayoutConnector from "../layoutGraph/layoutConnector";
import LayoutEdge from "../layoutGraph/layoutEdge";
import LayoutGraph from "../layoutGraph/layoutGraph";
import LayoutNode from "../layoutGraph/layoutNode";
import RenderConnector from "../renderGraph/renderConnector";
import RenderEdge from "../renderGraph/renderEdge";
import RenderGraph from "../renderGraph/renderGraph";
import RenderNode from "../renderGraph/renderNode";

export default abstract class Layouter {
    protected _options: any;

    constructor(options: object = {}) {
        this._options = _.defaults(options, {
            targetEdgeLength: 50,
            withLabels: false,
            bundle: false,
            optimizeAngles: false,
            shuffles: 0,
            shuffleGlobal: false,
            weightBends: 0.2,
            weightCrossings: 1,
            weightLengths: 0.1,
            preorderConnectors: false,
        });
    }

    public getOptionsForAnalysis(): object {
        return _.pick(this._options, [
            'targetEdgeLength',
            'weightBends',
            'weightCrossings',
            'weightLengths',
        ]);
    }

    public layout(renderGraph: RenderGraph): LayoutGraph {
        const layoutGraph = this.createLayoutGraph(renderGraph);

        this._createComponents(layoutGraph);

        if (this._options['bundle']) {
            this._createBundles(layoutGraph);
        }

        const tmpRandom = Math.random;
        seedrandom("I am the seed string.", {global: true});
        this.doLayout(layoutGraph);
        Math.random = tmpRandom;

        this._copyLayoutInfo(layoutGraph, renderGraph);
        if (DEBUG) {
            Assert.assertAll(renderGraph.allEdges(), (edge: RenderEdge) => edge.points.length > 0, "edge has no points assigned");
        }

        return layoutGraph;
    }

    protected abstract doLayout(graph: LayoutGraph): void;


    /**
     * Places the scoped connectors in the middle and the unscoped evenly on both sides.
     */
    protected _placeConnectorsCenter(graph: LayoutGraph): void {
        _.forEach(graph.allNodes(), (node: LayoutNode) => {
            const inConnectorsScoped = _.filter(node.inConnectors, connector => connector.isScoped);
            const inConnectorsUnscoped = _.filter(node.inConnectors, connector => !connector.isScoped);
            const outConnectorsScoped = _.filter(node.outConnectors, connector => connector.isScoped);
            const outConnectorsUnscoped = _.filter(node.outConnectors, connector => !connector.isScoped);

            const hasMoreInThanOut = inConnectorsUnscoped.length > outConnectorsUnscoped.length ? 1 : 0;
            const hasMoreOutThanIn = outConnectorsUnscoped.length > inConnectorsUnscoped.length ? 1 : 0;

            const arrangedInConnectors = [];
            const arrangedOutConnectors = [];
            for (let i = 0; i < inConnectorsUnscoped.length; ++i) {
                const isLeft = i < (inConnectorsUnscoped.length - hasMoreInThanOut) / 2;
                arrangedInConnectors[i + (isLeft ? 0 : inConnectorsScoped.length)] = inConnectorsUnscoped[i];
            }
            let offset = Math.ceil((inConnectorsUnscoped.length - hasMoreInThanOut) / 2);
            for (let i = 0; i < inConnectorsScoped.length; ++i) {
                arrangedInConnectors[i + offset] = inConnectorsScoped[i];
            }
            for (let i = 0; i < outConnectorsUnscoped.length; ++i) {
                let isLeft = i < (outConnectorsUnscoped.length - hasMoreOutThanIn) / 2;
                arrangedOutConnectors[i + (isLeft ? 0 : outConnectorsScoped.length)] = outConnectorsUnscoped[i];
            }
            offset = Math.ceil((outConnectorsUnscoped.length - hasMoreOutThanIn) / 2);
            for (let i = 0; i < outConnectorsScoped.length; ++i) {
                arrangedOutConnectors[i + offset] = outConnectorsScoped[i];
            }

            const connectorDifference = node.inConnectors.length - node.outConnectors.length;
            if (node.inConnectors.length > 0) {
                let inConnectorsWidth = node.inConnectors.length * CONNECTOR_SIZE + (node.inConnectors.length - 1) * CONNECTOR_SPACING;
                if (connectorDifference % 2 === -1 && inConnectorsScoped.length > 0) {
                    inConnectorsWidth += CONNECTOR_SIZE + CONNECTOR_SPACING;
                }
                const firstX = node.x + (node.width - inConnectorsWidth) / 2;
                const y = node.y - CONNECTOR_SIZE / 2;
                _.forEach(arrangedInConnectors, (connector: LayoutConnector, i) => {
                    connector.setPosition(firstX + (CONNECTOR_SIZE + CONNECTOR_SPACING) * i, y);
                });
            }
            if (node.outConnectors.length > 0) {
                let outConnectorsWidth = node.outConnectors.length * CONNECTOR_SIZE + (node.outConnectors.length - 1) * CONNECTOR_SPACING;
                if (connectorDifference % 2 === 1 && inConnectorsScoped.length > 0) {
                    outConnectorsWidth += CONNECTOR_SIZE + CONNECTOR_SPACING;
                }
                const firstX = node.x + (node.width - outConnectorsWidth) / 2;
                const y = node.y + node.height - CONNECTOR_SIZE / 2;
                _.forEach(arrangedOutConnectors, (connector, i) => {
                    connector.setPosition(firstX + (CONNECTOR_SIZE + CONNECTOR_SPACING) * i, y);
                });
            }
        });
    }

    protected _matchEdgesToConnectors(layoutGraph: LayoutGraph): void {
        _.forEach(layoutGraph.allEdges(), (edge: LayoutEdge) => {
            if (edge.srcConnector !== null) {
                const srcNode = <LayoutNode>edge.graph.node(edge.src);
                let srcConnector = srcNode.connector("OUT", edge.srcConnector);
                if (srcConnector === undefined && srcNode.childGraphs.length > 0) {
                    const childGraph = srcNode.childGraphs[0];
                    if (childGraph.exitNode !== null) {
                        srcConnector = childGraph.exitNode.connector("OUT", edge.srcConnector);
                    }
                }
                if (srcConnector === undefined) {
                    return;
                }
                edge.points[0] = srcConnector.boundingBox().bottomCenter();
            }
            if (edge.dstConnector !== null) {
                const dstNode = <LayoutNode>edge.graph.node(edge.dst);
                let dstConnector = dstNode.connector("IN", edge.dstConnector);
                if (dstConnector === undefined && dstNode.childGraphs.length > 0) {
                    const childGraph = <LayoutGraph>dstNode.childGraphs[0];
                    if (childGraph.entryNode !== null) {
                        dstConnector = childGraph.entryNode.connector("IN", edge.dstConnector);
                    }
                }
                if (dstConnector === undefined) {
                    return;
                }
                edge.points[edge.points.length - 1] = dstConnector.boundingBox().topCenter();
            }
        });
    }

    private createLayoutGraph(renderGraph: RenderGraph): LayoutGraph {
        const transformSubgraph = (renderGraph: RenderGraph): LayoutGraph => {
            let mayHaveCycles = false;
            if (renderGraph.parentNode === null || renderGraph.parentNode.type() === "NestedSDFG") {
                mayHaveCycles = true;
            }
            const layoutGraph = new LayoutGraph(mayHaveCycles);

            // add nodes and create groups for scopes (maps etc.)
            const createLayoutNode = (node: RenderNode) => {
                const layoutNode = new LayoutNode(node.size(), node.childPadding);
                if (node.type() === "AccessNode") {
                    layoutNode.isAccessNode = true;
                }
                _.forEach(node.inConnectors, (connector: RenderConnector) => {
                    layoutNode.addConnector("IN", connector.name);
                });
                _.forEach(node.outConnectors, (connector: RenderConnector) => {
                    layoutNode.addConnector("OUT", connector.name);
                });
                node.layoutNode = layoutNode;
                layoutNode.setLabel(node.label()); // for debugging
                return layoutNode;
            };

            // create layout nodes for scope entries and scopes around them
            const layoutChildren = new Map();
            _.forEach(renderGraph.nodes(), (node: RenderNode) => {
                if (node.type().endsWith("Entry")) {
                    // check if corresponding exit node exists
                    let exitExists = false;
                    _.forEach(renderGraph.nodes(), (node2: RenderNode) => {
                        if (node2.type().endsWith("Exit") && node2.scopeEntry === node.id) {
                            exitExists = true;
                        }
                    });
                    if (!exitExists) {
                        return;
                    }

                    const entryNode = createLayoutNode(node);
                    const scopeNode = new LayoutNode();
                    const scopeGraph = new LayoutGraph();
                    scopeNode.setChildGraph(scopeGraph);
                    scopeGraph.addNode(entryNode);
                    node.layoutGraph = scopeGraph;
                    node.layoutNode = entryNode;
                    scopeGraph.entryNode = entryNode;
                    scopeNode.isScopeNode = true;
                    layoutChildren.set(scopeNode, []);
                    scopeNode.setLabel("Map with entry " + entryNode.label()); // for debugging
                }
            });

            // create unscoped layout nodes and assign children (other than the entry) to the scope node
            _.forEach(renderGraph.nodes(), (node: RenderNode) => {
                if (node.scopeEntry === null) {
                    if (node.layoutNode) {
                        layoutGraph.addNode(node.layoutGraph.parentNode);
                    } else {
                        layoutGraph.addNode(createLayoutNode(node));
                        node.layoutGraph = layoutGraph;
                    }
                } else {
                    layoutChildren.get((renderGraph.node(node.scopeEntry)).layoutGraph.parentNode).push(node);
                }
            });

            // recursively add scope children
            const addScopeChildren = (layoutGraph: LayoutGraph) => {
                _.forEach(layoutGraph.nodes(), (node: LayoutNode) => {
                    if (layoutChildren.has(node)) {
                        _.forEach(layoutChildren.get(node), (renderNode: RenderNode) => {
                            if (renderNode.layoutNode) {
                                // renderNode is an entry node
                                node.childGraph.addNode(renderNode.layoutGraph.parentNode);
                            } else {
                                const layoutNode = createLayoutNode(renderNode);
                                node.childGraph.addNode(layoutNode);
                                renderNode.layoutGraph = node.childGraph;
                                if (renderNode.type().endsWith("Exit")) {
                                    node.childGraph.exitNode = layoutNode;
                                }
                            }
                        });
                    }
                    if (node.childGraph !== null) {
                        addScopeChildren(node.childGraph);
                    }
                });
            };
            addScopeChildren(layoutGraph);

            // add edges
            _.forEach(renderGraph.edges(), (edge: RenderEdge) => {
                let srcNode = renderGraph.node(edge.src);
                let dstNode = renderGraph.node(edge.dst);
                let srcLayoutNode = srcNode.layoutNode;
                let dstLayoutNode = dstNode.layoutNode;
                if (srcNode.layoutGraph !== dstNode.layoutGraph) {
                    if (dstNode.layoutGraph.entryNode === dstLayoutNode) {
                        dstLayoutNode = dstNode.layoutGraph.parentNode;
                    }
                    if (srcNode.layoutGraph.exitNode === srcLayoutNode) {
                        srcLayoutNode = srcNode.layoutGraph.parentNode;
                    }
                }
                if (DEBUG) {
                    Assert.assert(srcLayoutNode.graph === dstLayoutNode.graph, "edge between different graphs", edge);
                }
                // add implicit connectors (with name null)
                if (edge.src !== edge.dst) {
                    if (srcNode.layoutNode.connector("OUT", edge.srcConnector) === undefined) {
                        srcNode.layoutNode.addConnector("OUT", edge.srcConnector, true);
                    }
                    if (dstNode.layoutNode.connector("IN", edge.dstConnector) === undefined) {
                        dstNode.layoutNode.addConnector("IN", edge.dstConnector, true);
                    }
                }
                edge.layoutEdge = new LayoutEdge(srcLayoutNode.id, dstLayoutNode.id, edge.srcConnector, edge.dstConnector, edge.labelSize);
                srcLayoutNode.graph.addEdge(edge.layoutEdge);
            });

            // recursively transform subgraph
            _.forEach(renderGraph.nodes(), (node: RenderNode) => {
                if (node.childGraph !== null) {
                    node.layoutNode.setChildGraph(transformSubgraph(node.childGraph));
                }
            });
            renderGraph.layoutGraph = layoutGraph;
            return layoutGraph;
        }
        return transformSubgraph(renderGraph);
    }

    private _createComponents(graph: LayoutGraph): void {
        _.forEach(graph.allNodes(), (node: LayoutNode) => {
            if (node.childGraph !== null) {
                if (node.isScopeNode || node.childGraph.mayHaveCycles) {
                    node.childGraphs.push(node.childGraph);
                } else {
                    // only nodes of type NestedSDFG may have more than one component as child graph
                    _.forEach(node.childGraph.components(), (component: Component<LayoutNode, LayoutEdge>) => {
                        const childGraph = new LayoutGraph();
                        _.forEach(component.nodes(), (node: LayoutNode) => {
                            childGraph.addNode(node, node.id);
                        });
                        _.forEach(component.edges(), (edge: LayoutEdge) => {
                            childGraph.addEdge(edge, edge.id);
                        });
                        node.childGraphs.push(childGraph);
                        childGraph.parentNode = node;
                    });
                    if (node.childGraphs.length === 0) {
                        node.childGraphs.push(node.childGraph);
                    }
                }
                node.childGraph = null; // property childGraph should not be used after this point
            }
        });
    }

    private printLayout(graph: LayoutGraph, level: number = 0) {
        _.forEach(graph.nodes(), (node: LayoutNode) => {
            console.log("  ".repeat(level) + node.label());
            _.forEach(node.childGraphs, (childGraph: LayoutGraph) => {
                this.printLayout(childGraph, level + 1);
            });
        });
    }

    private _createBundles(layoutGraph: LayoutGraph): void
    {
        _.forEach(layoutGraph.allGraphs(), (graph: LayoutGraph) => {
            const bundles = new Map();
            _.forEach(graph.edges(), (edge: LayoutEdge) => {
                if ((edge.srcConnector !== null || edge.dstConnector !== null) && (edge.srcConnector === null || edge.dstConnector === null)) {
                    const key = edge.src + "_" + edge.dst;
                    const connectorName = edge.srcConnector || edge.dstConnector;
                    let bundle;
                    if (!bundles.has(key)) {
                        bundle = new LayoutBundle();
                        bundles.set(key, bundle);
                        if (connectorName === edge.srcConnector) {
                            let srcNode = graph.node(edge.src);
                            if (srcNode.isScopeNode) {
                                srcNode = srcNode.childGraphs[0].exitNode;
                            }
                            srcNode.outConnectorBundles.push(bundle);
                        } else {
                            let dstNode = graph.node(edge.dst);
                            if (dstNode.isScopeNode) {
                                dstNode = dstNode.childGraphs[0].entryNode;
                            }
                            dstNode.inConnectorBundles.push(bundle);
                        }
                    } else {
                        bundle = bundles.get(key);
                    }
                    bundle.connectors.push(connectorName);
                    if (edge.srcConnector !== null) {
                        edge.srcBundle = bundle;
                    } else {
                        edge.dstBundle = bundle;
                    }
                }
            });
        });
        // as soon as a node has some bundle, all edges have to be assigned a bundle
        // otherwise edges with and without bundles may create clutter and unwanted crossings
        _.forEach(layoutGraph.allNodes(), (node: LayoutNode) => {
            const addBundles = (bundles, connectors, edgeMethod, connectorProp, bundleProp, entryExit) => {
                if (node[bundles].length > 0) {
                    let graph = node.graph;
                    let id = node.id;
                    if (graph[entryExit] === node) {
                        graph = node.graph.parentNode.graph;
                        id = node.graph.parentNode.id;
                    }
                    if (_.some(node[bundles], bundle => bundle.connectors.length > 1)) {
                        const remainingConnectors = new Set();
                        _.forEach(node[connectors], (connector: LayoutConnector) => {
                            remainingConnectors.add(connector.name);
                        });
                        _.forEach(node[bundles], (bundle: LayoutBundle) => {
                            _.forEach(bundle.connectors, (name: string) => {
                                remainingConnectors.delete(name);
                            });
                        });
                        remainingConnectors.forEach((name: string) => {
                            const bundle = new LayoutBundle();
                            bundle.addConnector(name);
                            node[bundles].push(bundle);
                            _.forEach(graph[edgeMethod](id), (edge: LayoutEdge) => {
                                if (edge[connectorProp] === name) {
                                    edge[bundleProp] = bundle;
                                }
                            });
                        });
                    } else {
                        node[bundles] = [];
                        _.forEach(graph[edgeMethod](id), (edge: LayoutEdge) => {
                            edge[bundleProp] = null;
                        });
                    }
                }
            };
            addBundles("inConnectorBundles", "inConnectors", "inEdges", "dstConnector", "dstBundle", "entryNode");
            addBundles("outConnectorBundles", "outConnectors", "outEdges", "srcConnector", "srcBundle", "exitNode");
        });
        // mark all but one edges in a bundle as replica
        const bundles = new Set();
        _.forEach(layoutGraph.allEdges(), (edge: LayoutEdge) => {
            if (edge.srcBundle !== null || edge.dstBundle !== null) {
                const bundle = edge.srcBundle || edge.dstBundle;
                if (bundles.has(bundle)) {
                    edge.isReplica = true;
                } else {
                    bundles.add(bundle);
                }
                bundle.edges.push(edge);
            }
        });
    }

    private _copyLayoutInfo(layoutGraph: LayoutGraph, renderGraph: RenderGraph) {
        _.forEach(renderGraph.allNodes(), (node: RenderNode) => {
            _.assign(node, node.layoutNode.boundingBox());
            _.forEach(_.concat(node.inConnectors), (connector: RenderConnector) => {
                _.assign(connector, node.layoutNode.connector("IN", connector.name).boundingBox());
            });
            _.forEach(_.concat(node.outConnectors), (connector: RenderConnector) => {
                _.assign(connector, node.layoutNode.connector("OUT", connector.name).boundingBox());
            });

            delete node.layoutGraph;
            delete node.layoutNode;
        });
        _.forEach(renderGraph.allEdges(), (edge: RenderEdge) => {
            _.assign(edge, _.pick(edge.layoutEdge, ['points']));
            // duplicate bundle points to make curved edges go through them
            if (edge.layoutEdge.srcBundle !== null) {
                edge.points.splice(1, 0, edge.points[1].clone());
            }
            if (edge.layoutEdge.dstBundle !== null) {
                edge.points.splice(edge.points.length - 2, 0, edge.points[edge.points.length - 2].clone());
            }
            edge.updateBoundingBox();
            delete edge.layoutEdge;
        });
        _.forEach(renderGraph.allGraphs(), (graph: RenderGraph) => {
            delete graph.layoutGraph;
        });
    }


}
