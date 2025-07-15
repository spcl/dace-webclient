// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import dagre from 'dagre';

import { SDFVSettings } from '../utils/sdfv_settings';
import { SMLayouter } from './state_machine/sm_layouter';
import {
    JsonSDFG,
    JsonSDFGBlock,
    JsonSDFGCodeBlock,
    JsonSDFGConditionalBlock,
    JsonSDFGControlFlowRegion,
    JsonSDFGEdge,
    JsonSDFGMultiConnectorEdge,
    JsonSDFGNode,
    Point2D,
    Size2D,
} from '../types';
import {
    AccessNode,
    ConditionalBlock,
    Connector,
    ControlFlowRegion,
    InterstateEdge,
    LoopRegion,
    Memlet,
    NestedSDFG,
    ScopeNode,
    SDFG,
    SDFGElement,
    SDFGElements,
    SDFGElementType,
    SDFGNode,
    State,
} from '../renderer/sdfg/sdfg_elements';
import { sdfgPropertyToString } from '../utils/sdfg/display';
import { SDFV } from '../sdfv';
import {
    checkAndRedirectEdge,
    findExitForEntry,
} from '../utils/sdfg/sdfg_utils';
import {
    calculateBoundingBox,
    calculateEdgeBoundingBox,
} from '../utils/bounding_box';
import { deepCopy, intersectRect } from '../utils/utils';
import {
    CFDataDependencyLense,
} from '../overlays/lenses/cf_data_dependency_lense';
import type {
    CFGListType,
    DagreGraph,
    SDFGRenderer,
} from '../renderer/sdfg/sdfg_renderer';

interface ICFGBlockInfo {
    label?: string,
    width: number,
    height: number,
}

interface ILayoutAttr {
    x: number,
    y: number,
    width: number,
    height: number,
    in_connectors: Record<string, unknown>,
    out_connectors: Record<string, unknown>,
}

function offsetControlFlowRegion(
    cfg: JsonSDFGControlFlowRegion, cfgGraph: DagreGraph, offs: Point2D
): void {
    cfg.nodes.forEach((blockJson: JsonSDFGBlock, id: number) => {
        const block = cfgGraph.node(id.toString());
        if (block) {
            block.x += offs.x;
            block.y += offs.y;
            if (!block.attributes()?.is_collapsed) {
                if (block instanceof State) {
                    offsetSDFGState(block, offs);
                } else if (block instanceof ConditionalBlock) {
                    offsetConditionalBlock(block, offs);
                } else if (block instanceof ControlFlowRegion) {
                    if (block.graph) {
                        offsetControlFlowRegion(
                            blockJson as JsonSDFGControlFlowRegion, block.graph,
                            offs
                        );
                    }
                }
            }
        }
    });
    cfg.edges.forEach((e: JsonSDFGEdge, _eid: number) => {
        const edge = cfgGraph.edge({ v: e.src, w: e.dst });
        if (edge) {
            edge.x += offs.x;
            edge.y += offs.y;
            edge.points.forEach((p: Point2D) => {
                p.x += offs.x;
                p.y += offs.y;
            });
        }
    });
}

/**
 * Offset a conditional block's contents by a given offset.
 * @param block Conditional block to offset.
 * @param offs  Offset by which to move everything.
 */
function offsetConditionalBlock(block: ConditionalBlock, offs: Point2D): void {
    for (const [_, region] of block.branches) {
        const regionElem = region.jsonData;
        region.x += offs.x;
        region.y += offs.y;
        if (!region.attributes()?.is_collapsed && regionElem && region.graph)
            offsetControlFlowRegion(regionElem, region.graph, offs);
    }
}

/**
 * Offset an entire SDFG state's contents by a given offset.
 * @param state State to offset.
 * @param offs  Offset by which to move everything.
 */
function offsetSDFGState(state: State, offs: Point2D): void {
    const drawnNodes = new Set<string>();

    const jsonState = state.jsonData;
    const stateGraph = state.graph;
    if (!stateGraph || !jsonState)
        return;
    jsonState.nodes.forEach((_n, nid) => {
        const node = stateGraph.node(nid.toString()) as SDFGNode | undefined;
        if (!node)
            return;
        drawnNodes.add(nid.toString());

        node.x += offs.x;
        node.y += offs.y;
        node.inConnectors.forEach((c: Connector) => {
            c.x += offs.x;
            c.y += offs.y;
        });
        node.outConnectors.forEach((c: Connector) => {
            c.x += offs.x;
            c.y += offs.y;
        });

        const nAttr = node.attributes();
        if (node instanceof NestedSDFG && nAttr?.sdfg && node.graph &&
            !('is_collapsed' in nAttr && nAttr.is_collapsed)
        )
            offsetControlFlowRegion(nAttr.sdfg as JsonSDFG, node.graph, offs);
    });
    jsonState.edges.forEach((e, eid) => {
        const ne = checkAndRedirectEdge(e, drawnNodes, jsonState);
        if (!ne)
            return;
        e = ne;
        const edge = stateGraph.edge({
            v: e.src,
            w: e.dst,
            name: eid.toString(),
        });
        if (edge) {
            edge.x += offs.x;
            edge.y += offs.y;
            edge.points.forEach((p: Point2D) => {
                p.x += offs.x;
                p.y += offs.y;
            });
        }
    });
}

/**
 * Calculate the size of a dataflow node.
 * @param sdfg  SDFG the node belongs to, in its JSON representation.
 * @param node  Node to calculate the size for, in its JSON representation.
 * @param ctx   Canvas rendering context, if available.
 * @returns     Size of the node.
 */
function calculateDFNodeSize(
    sdfg: JsonSDFG, node: JsonSDFGNode, ctx?: CanvasRenderingContext2D
): Size2D {
    node.attributes ??= {
        layout: {},
    };

    let label;
    switch (node.type) {
        case SDFGElementType.AccessNode.toString():
            label = node.label;
            if (SDFVSettings.get<boolean>('showDataDescriptorSizes')) {
                const nodedesc = sdfg.attributes?._arrays[label] as {
                    attributes?: { shape?: string },
                } | undefined;
                if (nodedesc?.attributes?.shape) {
                    label = ' ' + sdfgPropertyToString(
                        nodedesc.attributes.shape
                    );
                }
            }
            break;
        default:
            label = node.label;
            break;
    }

    const labelsize = ctx ? ctx.measureText(label).width : 1;
    const inconnsize = 2 * SDFV.LINEHEIGHT * Object.keys(
        node.attributes.layout?.in_connectors ?? {}
    ).length - SDFV.LINEHEIGHT;
    const outconnsize = 2 * SDFV.LINEHEIGHT * Object.keys(
        node.attributes.layout?.out_connectors ?? {}
    ).length - SDFV.LINEHEIGHT;
    const maxwidth = Math.max(labelsize, inconnsize, outconnsize);
    let maxheight = 2 * SDFV.LINEHEIGHT;
    maxheight += 4 * SDFV.LINEHEIGHT;

    const size: Size2D = { w: maxwidth, h: maxheight };

    // add something to the size based on the shape of the node
    switch (node.type) {
        case SDFGElementType.AccessNode.toString():
            size.h -= 4 * SDFV.LINEHEIGHT;
            size.w += size.h;
            break;
        case SDFGElementType.MapEntry.toString():
        case SDFGElementType.ConsumeEntry.toString():
        case SDFGElementType.PipelineEntry.toString():
        case SDFGElementType.MapExit.toString():
        case SDFGElementType.ConsumeExit.toString():
        case SDFGElementType.PipelineExit.toString():
            size.w += 2.0 * size.h;
            size.h /= 1.75;
            break;
        case SDFGElementType.Tasklet.toString():
            size.w += 2.0 * (size.h / 3.0);
            size.h /= 1.75;
            break;
        case SDFGElementType.LibraryNode.toString():
            size.w += 2.0 * (size.h / 3.0);
            size.h /= 1.75;
            break;
        case SDFGElementType.Reduce.toString():
            size.h -= 4 * SDFV.LINEHEIGHT;
            size.w *= 2;
            size.h = size.w / 3.0;
            break;
    }

    return size;
}

interface IHiddenNode {
    node: JsonSDFGNode;
    src?: JsonSDFGMultiConnectorEdge;
    dsts: JsonSDFGMultiConnectorEdge[];
}

/**
 * Perform layouting for a dataflow node.
 * For scope nodes or nested SDFG nodes, this recurses into the nested scope or
 * graph.
 * @param node              Dataflow node to perform layouting for (JSON).
 * @param state             State the node lives within (graph element).
 * @param graph             State graph the node lives inside (dagre graph).
 * @param hiddenNodes       Dictionary of hidden nodes.
 * @param drawnNodes        Set of nodes that are not hidden, i.e., are drawn.
 * @param ctx               Canvas rendering context, if available.
 * @param cfgList           The global control flow graph list.
 * @param stateParentList   List of parent-pointing states.
 * @param omitAccessNodes   Whether or not to omit access nodes.
 */
function layoutDFNode(
    renderer: SDFGRenderer, node: JsonSDFGNode, state: State, graph: DagreGraph,
    hiddenNodes: Map<string, IHiddenNode>, drawnNodes: Set<string>,
    ctx: CanvasRenderingContext2D, cfgList?: CFGListType,
    stateParentList?: any[], omitAccessNodes: boolean = false
): void {
    node.attributes ??= {};
    node.attributes.layout ??= {};

    if (omitAccessNodes &&
        node.type === SDFGElementType.AccessNode.toString()) {
        // Add access node to hidden nodes; source and destinations will be
        // set later.
        hiddenNodes.set(
            node.id.toString(), { node: node, src: undefined, dsts: [] }
        );
        return;
    }

    let nestedGraph = null;

    // Set connectors prior to computing node size
    node.attributes.layout.in_connectors =
        node.attributes.in_connectors ?? {};
    if ('is_collapsed' in node.attributes && node.attributes.is_collapsed &&
        node.type !== SDFGElementType.NestedSDFG.toString() &&
        node.type !== SDFGElementType.ExternalNestedSDFG.toString()) {
        node.attributes.layout.out_connectors = findExitForEntry(
            state.jsonData?.nodes ?? [], node
        )?.attributes?.out_connectors ?? {};
    } else {
        node.attributes.layout.out_connectors =
            node.attributes.out_connectors ?? {};
    }

    const nodeSize = calculateDFNodeSize(state.sdfg, node, ctx);
    node.attributes.layout.width = nodeSize.w;
    node.attributes.layout.height = nodeSize.h;
    node.attributes.layout.label = node.label;

    // Recursively lay out nested SDFGs.
    if (node.type === SDFGElementType.NestedSDFG.toString() ||
        node.type === SDFGElementType.ExternalNestedSDFG.toString()) {
        if (node.attributes.sdfg &&
            node.attributes.sdfg.type !== 'SDFGShell') {
            if ('is_collapsed' in node.attributes &&
                node.attributes.is_collapsed) {
                // Noop.
            } else {
                const nsdfg = new SDFG(renderer, ctx, node.attributes.sdfg);
                nestedGraph = layoutControlFlowRegion(
                    renderer, node.attributes.sdfg, nsdfg, ctx, cfgList,
                    stateParentList, omitAccessNodes
                );
                const sdfgInfo = calculateBoundingBox(nestedGraph);
                node.attributes.layout.width =
                    sdfgInfo.width + 2 * SDFV.LINEHEIGHT;
                node.attributes.layout.height =
                    sdfgInfo.height + 2 * SDFV.LINEHEIGHT;
            }
        } else {
            const emptyNSDFGLabel = 'No SDFG loaded';
            const textMetrics = ctx.measureText(emptyNSDFGLabel);
            node.attributes.layout.width =
                textMetrics.width + 2 * SDFV.LINEHEIGHT;
            node.attributes.layout.height = 4 * SDFV.LINEHEIGHT;
        }
    }

    // Dynamically create node type.
    const obj = new SDFGElements[node.type](
        renderer, ctx, { node: node, graph: nestedGraph }, node.id, state.sdfg,
        state.cfg, state.id, state
    );

    // If it's a nested SDFG, we need to record the node as all of its
    // state's parent node.
    if ((node.type === SDFGElementType.NestedSDFG.toString() ||
        node.type === SDFGElementType.ExternalNestedSDFG.toString()) &&
        node.attributes.sdfg && node.attributes.sdfg.type !== 'SDFGShell' &&
        stateParentList !== undefined && cfgList !== undefined
    ) {
        stateParentList[node.attributes.sdfg.cfg_list_id] = obj;
        cfgList[node.attributes.sdfg.cfg_list_id].nsdfgNode = obj as NestedSDFG;
    }

    // Add input connectors.
    let i = 0;
    let conns;
    if (Array.isArray(node.attributes.layout.in_connectors))
        conns = node.attributes.layout.in_connectors;
    else
        conns = Object.keys(node.attributes.layout.in_connectors ?? {});
    for (const cname of conns) {
        const conn = new Connector(
            renderer, ctx, { name: cname }, i, state.sdfg, state.cfg, node.id,
            obj
        );
        conn.connectorType = 'in';
        conn.linkedElem = obj;
        obj.inConnectors.push(conn);
        i += 1;
    }

    // Add output connectors -- if collapsed, uses exit node connectors.
    i = 0;
    if (Array.isArray(node.attributes.layout.out_connectors))
        conns = node.attributes.layout.out_connectors;
    else
        conns = Object.keys(node.attributes.layout.out_connectors ?? {});
    for (const cname of conns) {
        const conn = new Connector(
            renderer, ctx, { name: cname }, i, state.sdfg, state.cfg, node.id,
            obj
        );
        conn.connectorType = 'out';
        conn.linkedElem = obj;
        obj.outConnectors.push(conn);
        i += 1;
    }

    // Add nodes to the graph. The first argument is the node id. The
    // second is metadata about the node (label, width, height),
    // which will be updated by dagre.layout (will add x,y).
    graph.setNode(node.id.toString(), obj);
    drawnNodes.add(node.id.toString());

    // Recursively draw nodes.
    const jsonState = state.jsonData;
    if (jsonState?.scope_dict && node.id in jsonState.scope_dict) {
        if (node.attributes.is_collapsed)
            return;
        jsonState.scope_dict[node.id]!.forEach(nodeid => {
            const node = jsonState.nodes[nodeid];
            layoutDFNode(
                renderer, node, state, graph, hiddenNodes, drawnNodes, ctx,
                cfgList, stateParentList, omitAccessNodes
            );
        });
    }
}

/**
 * Lay out an SDFG State.
 * @param state             State to lay out.
 * @param ctx               Renderer context if available.
 * @param cfgList           Global index of control flow graphs.
 * @param stateParentList   Parent pointing state list.
 * @param omitAccessNodes   Whether or not to draw access nodes.
 * @returns                 Layout graph for the state.
 */
function layoutSDFGState(
    renderer: SDFGRenderer, state: State, ctx: CanvasRenderingContext2D,
    cfgList?: CFGListType, stateParentList?: any[],
    omitAccessNodes: boolean = false
): DagreGraph {
    const stateJson = state.jsonData;
    if (!stateJson)
        return new dagre.graphlib.Graph() as unknown as DagreGraph;

    // layout the sdfg block as a dagre graph.
    const g = new dagre.graphlib.Graph({
        multigraph: true,
    }) as unknown as DagreGraph;

    // Set layout options and a simpler algorithm for large graphs.
    const layoutOptions = {
        ranksep: SDFVSettings.get<number>('ranksep'),
        nodesep: SDFVSettings.get<number>('nodesep'),
        ranker: stateJson.nodes.length >= 1000 ? 'longest-path' : undefined,
    };

    g.setGraph(layoutOptions);

    // Set an object for the graph label.
    g.setDefaultEdgeLabel(() => {
        return {};
    });

    // Recursively process (i.e., lay out) all nodes of the state and add them
    // to the graph.
    let topLevelNodes = stateJson.scope_dict?.[-1];
    topLevelNodes ??= Object.keys(stateJson.nodes).map(v => parseInt(v));
    const drawnNodes = new Set<string>();
    const hiddenNodes = new Map<string, IHiddenNode>();
    topLevelNodes.forEach(nodeid => {
        const node = stateJson.nodes[nodeid];
        layoutDFNode(
            renderer, node, state, g, hiddenNodes, drawnNodes, ctx, cfgList,
            stateParentList, omitAccessNodes
        );
    });

    // Add info to calculate shortcut edges.
    function addEdgeInfoIfHidden(edge: JsonSDFGMultiConnectorEdge) {
        const hiddenSrc = hiddenNodes.get(edge.src);
        const hiddenDst = hiddenNodes.get(edge.dst);
        const edgeAttr = (edge.attributes?.data?.attributes) as {
            shortcut?: boolean,
        } | undefined;
        if (!edgeAttr)
            return false;

        if (hiddenSrc && hiddenDst) {
            // If we have edges from an AccessNode to an AccessNode then just
            // connect destinations.
            hiddenSrc.dsts = hiddenDst.dsts;
            edgeAttr.shortcut = false;
        } else if (hiddenSrc) {
            // If edge starts at hidden node, then add it as destination.
            hiddenSrc.dsts.push(edge);
            edgeAttr.shortcut = false;
            return true;
        } else if (hiddenDst) {
            // If edge ends at hidden node, then add it as source.
            hiddenDst.src = edge;
            edgeAttr.shortcut = false;
            return true;
        }

        // If it is a shortcut edge, but we don't omit access nodes, then ignore
        // this edge.
        if (!omitAccessNodes && edgeAttr.shortcut)
            return true;

        return false;
    }

    stateJson.edges.forEach((edge, id) => {
        if (addEdgeInfoIfHidden(edge))
            return;
        const redirEdge = checkAndRedirectEdge(edge, drawnNodes, stateJson);

        if (!redirEdge?.attributes?.data)
            return;

        const e = new Memlet(
            renderer, ctx, redirEdge.attributes.data, id, state.sdfg, state.cfg,
            state.id, state
        );
        redirEdge.attributes.data.edge = e;
        e.srcConnector = redirEdge.src_connector;
        e.dstConnector = redirEdge.dst_connector;
        g.setEdge(redirEdge.src, redirEdge.dst, e, id.toString());
    });

    hiddenNodes.forEach(hiddenNode => {
        if (hiddenNode.src) {
            hiddenNode.dsts.forEach(e => {
                // Create shortcut edge with new destination.
                const tmpEdge = e.attributes?.data?.edge;
                if (e.attributes?.data)
                    e.attributes.data.edge = undefined;
                const shortCutEdge = deepCopy(e);
                if (e.attributes?.data)
                    e.attributes.data.edge = tmpEdge;
                shortCutEdge.src = hiddenNode.src?.src ?? '';
                shortCutEdge.src_connector = hiddenNode.src?.src_connector;
                shortCutEdge.dst_connector = e.dst_connector;
                // Attribute that only shortcut edges have; if it is explicitly
                // false, then edge is ignored in omit access node mode.
                if (shortCutEdge.attributes?.data?.attributes)
                    shortCutEdge.attributes.data.attributes.shortcut = true;

                // Draw the redirected edge.
                const redirectedEdge = checkAndRedirectEdge(
                    shortCutEdge, drawnNodes, stateJson
                );
                if (!redirectedEdge?.attributes?.data)
                    return;

                // Abort if shortcut edge already exists.
                const edges = g.outEdges(redirectedEdge.src);
                if (edges) {
                    for (const oe of edges) {
                        if (oe.w === e.dst && oe.name &&
                            stateJson.edges[
                                parseInt(oe.name)
                            ].dst_connector === e.dst_connector
                        )
                            return;
                    }
                }

                // Add shortcut edge (redirection is not done in this list).
                stateJson.edges.push(shortCutEdge);

                // Add redirected shortcut edge to graph.
                const edgeId = stateJson.edges.length - 1;
                const newShortCutEdge = new Memlet(
                    renderer, ctx, deepCopy(
                        redirectedEdge.attributes.data as
                        Record<string, unknown>
                    ), edgeId, state.sdfg, state.cfg, stateJson.id
                );
                newShortCutEdge.srcConnector = redirectedEdge.src_connector;
                newShortCutEdge.dstConnector = redirectedEdge.dst_connector;
                newShortCutEdge.attributes()!.shortcut = true;

                g.setEdge(
                    redirectedEdge.src, redirectedEdge.dst, newShortCutEdge,
                    edgeId.toString()
                );
            });
        }
    });

    dagre.layout(g as unknown as dagre.graphlib.Graph);

    // Layout connectors and nested SDFGs.
    stateJson.nodes.forEach((node: JsonSDFGNode, id: number) => {
        const gnode = g.node(id.toString()) as SDFGNode | undefined;
        if (!gnode || (omitAccessNodes && gnode instanceof AccessNode)) {
            // Ignore nodes that should not be drawn.
            return;
        }
        const topleft = gnode.topleft();

        // Offset nested SDFG.
        if (node.type === SDFGElementType.NestedSDFG.toString() &&
            node.attributes?.sdfg && gnode.graph &&
            !('is_collapsed' in node.attributes && node.attributes.is_collapsed)
        ) {
            offsetControlFlowRegion(node.attributes.sdfg, gnode.graph, {
                x: topleft.x + SDFV.LINEHEIGHT,
                y: topleft.y + SDFV.LINEHEIGHT,
            });
        }
        // Write back layout information.
        node.attributes ??= {};
        node.attributes.layout ??= {};
        node.attributes.layout.x = gnode.x;
        node.attributes.layout.y = gnode.y;
        // Connector management.
        const SPACING = SDFV.LINEHEIGHT;
        const iConnLength = (SDFV.LINEHEIGHT + SPACING) * Object.keys(
            node.attributes.layout.in_connectors ?? {}
        ).length - SPACING;
        const oConnLength = (SDFV.LINEHEIGHT + SPACING) * Object.keys(
            node.attributes.layout.out_connectors ?? {}
        ).length - SPACING;
        let iConnX = gnode.x - iConnLength / 2.0 + SDFV.LINEHEIGHT / 2.0;
        let oConnX = gnode.x - oConnLength / 2.0 + SDFV.LINEHEIGHT / 2.0;

        for (const c of gnode.inConnectors) {
            c.width = SDFV.LINEHEIGHT;
            c.height = SDFV.LINEHEIGHT;
            c.x = iConnX;
            iConnX += SDFV.LINEHEIGHT + SPACING;
            c.y = topleft.y;
        }
        for (const c of gnode.outConnectors) {
            c.width = SDFV.LINEHEIGHT;
            c.height = SDFV.LINEHEIGHT;
            c.x = oConnX;
            oConnX += SDFV.LINEHEIGHT + SPACING;
            c.y = topleft.y + gnode.height;
        }
    });

    // Re-order in_connectors for the edges to not intertwine
    stateJson.nodes.forEach((node: JsonSDFGNode, id: number) => {
        const gnode = g.node(id.toString()) as SDFGNode | undefined;
        if (!gnode || (omitAccessNodes && gnode instanceof AccessNode)) {
            // Ignore nodes that should not be drawn.
            return;
        }

        // Summarize edges for NestedSDFGs and ScopeNodes
        if (SDFVSettings.get<boolean>('summarizeLargeNumbersOfEdges')) {
            if (gnode instanceof NestedSDFG || gnode instanceof ScopeNode) {
                const nInConnectors = gnode.inConnectors.length;
                const nOutConnectors = gnode.outConnectors.length;

                if (nInConnectors > 10) {
                    gnode.summarizeInEdges = true;
                    gnode.inSummaryHasEffect = true;
                }
                if (nOutConnectors > 10) {
                    gnode.summarizeOutEdges = true;
                    gnode.outSummaryHasEffect = true;
                }
            }
        }
        const SPACING = SDFV.LINEHEIGHT;
        node.attributes ??= {};
        node.attributes.layout ??= {};
        const iConnLength = (SDFV.LINEHEIGHT + SPACING) * Object.keys(
            node.attributes.layout.in_connectors ?? {}
        ).length - SPACING;
        let iConnX = gnode.x - iConnLength / 2.0 + SDFV.LINEHEIGHT / 2.0;

        // Dictionary that saves the x coordinates of each connector's source
        // node or source connector. This is later used to reorder the
        // in_connectors based on the sources' x coordinates.
        const sourcesXCoordinates: Record<string, number> = {};

        // For each in_connector, find the x coordinate of the source node
        // connector.
        for (const c of gnode.inConnectors) {
            stateJson.edges.forEach((edge: JsonSDFGEdge, id: number) => {
                if (edge.dst === gnode.id.toString() &&
                    edge.dst_connector === c.data?.name) {
                    // If in-edges are to be summarized, set Memlet.summarized
                    const gedge = g.edge({
                        v: edge.src,
                        w: edge.dst,
                        name: id.toString(),
                    });
                    if (gedge && gnode.summarizeInEdges)
                        gedge.summarized = true;

                    const sourceNode = g.node(edge.src) as SDFGNode | undefined;
                    if (sourceNode) {
                        // If source node doesn't have out_connectors, take
                        // the source node's own x coordinate
                        if (sourceNode.outConnectors.length === 0) {
                            sourcesXCoordinates[
                                c.data!.name as string
                            ] = sourceNode.x;
                        } else {
                            // Find the corresponding out_connector and take its
                            // x coordinate.
                            const nOutConn = sourceNode.outConnectors.length;
                            for (let i = 0; i < nOutConn; ++i) {
                                if (sourceNode.outConnectors[i].data?.name ===
                                    edge.src_connector) {
                                    sourcesXCoordinates[
                                        c.data!.name as string
                                    ] = sourceNode.outConnectors[i].x;
                                    break;
                                }
                            }
                        }
                    }
                }
            });
        }

        // Sort the dictionary by x coordinate values
        const sourcesXCoordinatesSorted = Object.entries(sourcesXCoordinates);
        sourcesXCoordinatesSorted.sort((a, b) => a[1] - b[1]);

        // In the order of the sorted source x coordinates, set the x
        // coordinates of the in_connectors.
        for (const element of sourcesXCoordinatesSorted) {
            for (const c of gnode.inConnectors) {
                if (c.data?.name === element[0]) {
                    c.x = iConnX;
                    iConnX += SDFV.LINEHEIGHT + SPACING;
                    continue;
                }
            }
        }

        // For out_connectors set Memlet.summarized for all out-edges if needed
        if (gnode.summarizeOutEdges) {
            for (const c of gnode.outConnectors) {
                stateJson.edges.forEach((edge: JsonSDFGEdge, id: number) => {
                    if (edge.src === gnode.id.toString() &&
                        edge.src_connector === c.data!.name) {
                        const gedge = g.edge({
                            v: edge.src,
                            w: edge.dst,
                            name: id.toString(),
                        });
                        if (gedge)
                            gedge.summarized = true;
                    }
                });
            }
        }
    });

    stateJson.edges.forEach((edge: JsonSDFGEdge, id: number) => {
        const nedge = checkAndRedirectEdge(edge, drawnNodes, stateJson);
        if (!nedge)
            return;
        edge = nedge;
        const gedge = g.edge({
            v: edge.src,
            w: edge.dst,
            name: id.toString(),
        });
        const gedgeAttrs = gedge?.attributes();
        if (!gedge || ((omitAccessNodes && gedgeAttrs?.shortcut === false) ||
            (!omitAccessNodes && gedgeAttrs?.shortcut))) {
            // If access nodes omitted, don't draw non-shortcut edges and
            // vice versa.
            return;
        }

        // Reposition first and last points according to connectors.
        let srcConn = null;
        let dstConn = null;
        if (edge.src_connector) {
            const srcNode = g.node(edge.src);
            if (srcNode) {
                let cindex = -1;
                for (let i = 0; i < srcNode.outConnectors.length; i++) {
                    if (srcNode.outConnectors[i].data?.name ===
                        edge.src_connector) {
                        cindex = i;
                        break;
                    }
                }
                if (cindex >= 0) {
                    gedge.points[0].x = srcNode.outConnectors[cindex].x;
                    gedge.points[0].y = srcNode.outConnectors[cindex].y;
                    srcConn = srcNode.outConnectors[cindex];
                }
            }
        }
        if (edge.dst_connector) {
            const dstNode = g.node(edge.dst);
            if (dstNode) {
                let cindex = -1;
                for (let i = 0; i < dstNode.inConnectors.length; i++) {
                    const c = dstNode.inConnectors[i];
                    if (c.data?.name === edge.dst_connector) {
                        cindex = i;
                        break;
                    }
                }
                if (cindex >= 0) {
                    gedge.points[gedge.points.length - 1].x =
                        dstNode.inConnectors[cindex].x;
                    gedge.points[gedge.points.length - 1].y =
                        dstNode.inConnectors[cindex].y;
                    dstConn = dstNode.inConnectors[cindex];
                }
            }
        }

        const n = gedge.points.length - 1;
        if (srcConn !== null)
            gedge.points[0] = intersectRect(srcConn, gedge.points[n]);
        if (dstConn !== null)
            gedge.points[n] = intersectRect(dstConn, gedge.points[0]);

        if (gedge.points.length === 3 &&
            gedge.points[0].x === gedge.points[n].x)
            gedge.points = [gedge.points[0], gedge.points[n]];

        const bb = calculateEdgeBoundingBox(gedge);
        // Convert from top-left to center
        bb.x += bb.width / 2.0;
        bb.y += bb.height / 2.0;

        edge.width = bb.width;
        edge.height = bb.height;
        edge.x = bb.x;
        edge.y = bb.y;
        gedge.width = bb.width;
        gedge.height = bb.height;
        gedge.x = bb.x;
        gedge.y = bb.y;
    });

    return g;
}

/**
 * Lay out a conditional block.
 * @param condBlock         Conditional block to lay out (JSON)
 * @param condBlockElem
 * @param ctx
 * @param cfgList
 * @param stateParentList
 * @param omitAccessNodes
 * @returns
 */
function layoutConditionalBlock(
    renderer: SDFGRenderer, condBlockElem: ConditionalBlock,
    ctx: CanvasRenderingContext2D, cfgList?: CFGListType,
    stateParentList?: any[], omitAccessNodes: boolean = false
): DagreGraph {
    const BLOCK_MARGIN = 3 * SDFV.LINEHEIGHT;
    const sdfg = condBlockElem.sdfg;
    const condBlock = condBlockElem.jsonData as JsonSDFGConditionalBlock;

    // Layout the state machine as a dagre graph.
    const g = new dagre.graphlib.Graph() as unknown as DagreGraph;
    g.setGraph({});
    g.setDefaultEdgeLabel(() => {
        return {};
    });

    // layout each block individually to get its size.
    let maxBranchHeight = 0;
    for (let id = 0; id < condBlock.branches.length; id++) {
        const [condition, block] = condBlock.branches[id];
        block.id = id;
        const blockInfo: ICFGBlockInfo = {
            label: undefined,
            width: 0,
            height: 0,
        };
        const blockEl = new ControlFlowRegion(
            renderer, ctx, { layout: { width: 0, height: 0 } }, block.id, sdfg,
            undefined, undefined, condBlockElem
        );
        g.setNode(block.id.toString(), blockEl);
        blockEl.data!.block = block;
        condBlockElem.branches.push([condition, blockEl]);

        blockInfo.label = block.id.toString();
        if (block.attributes?.is_collapsed) {
            blockInfo.width = ctx.measureText(
                condition?.string_data ?? 'else'
            ).width;
            blockInfo.height = SDFV.LINEHEIGHT;
        } else {
            const blockGraph = layoutControlFlowRegion(
                renderer, block, blockEl, ctx, cfgList, stateParentList,
                omitAccessNodes
            );
            const bb = calculateBoundingBox(blockGraph);
            blockInfo.width = bb.width;
            blockInfo.height = bb.height;
            blockEl.data!.graph = blockGraph;
        }

        blockInfo.width += 2 * BLOCK_MARGIN;
        blockInfo.height += 2 * BLOCK_MARGIN;
        blockEl.data!.layout = blockInfo;
        blockEl.setLayout();

        maxBranchHeight = Math.max(maxBranchHeight, blockInfo.height);
    }

    // Offset each branch inside the conditional region and size it according
    // to the height of the highest / longest branch.
    let offsetAmount = 0;
    for (const [_, branch] of condBlockElem.branches) {
        branch.height = maxBranchHeight;
        branch.y = (
            condBlockElem.y + (maxBranchHeight / 2) +
            ConditionalBlock.CONDITION_SPACING
        );
        branch.x = condBlockElem.x + (branch.width / 2) + offsetAmount;
        if (!branch.attributes()?.is_collapsed) {
            offsetControlFlowRegion(
                branch.jsonData!, branch.graph!, {
                    x: offsetAmount + BLOCK_MARGIN,
                    y: BLOCK_MARGIN + ConditionalBlock.CONDITION_SPACING,
                }
            );
        }
        offsetAmount += branch.width;
    }

    // Annotate the JSON with layout information
    for (const [_, branch] of condBlock.branches) {
        const gnode = g.node(branch.id.toString());
        if (gnode) {
            branch.attributes ??= {};
            branch.attributes.layout = {
                x: gnode.x,
                y: gnode.y,
                width: gnode.width,
                height: gnode.height,
            };
        }
    }

    return g;
}

function layoutControlFlowRegion(
    renderer: SDFGRenderer, cfg: JsonSDFGControlFlowRegion,
    cfgElem: ControlFlowRegion | SDFG, ctx: CanvasRenderingContext2D,
    cfgList?: CFGListType, stateParentList?: any[],
    omitAccessNodes: boolean = false
): DagreGraph {
    const BLOCK_MARGIN = 3 * SDFV.LINEHEIGHT;
    const sdfg = cfgElem.sdfg;

    // Layout the state machine as a dagre graph.
    const g = new dagre.graphlib.Graph() as unknown as DagreGraph;
    g.setGraph({});
    g.setDefaultEdgeLabel(() => {
        return {};
    });

    // layout each block individually to get its size.
    for (const block of cfg.nodes) {
        const blockInfo: ICFGBlockInfo = {
            label: undefined,
            width: 0,
            height: 0,
        };

        const blockElem = new SDFGElements[block.type](
            renderer, ctx, { layout: { width: 0, height: 0 } }, block.id, sdfg,
            cfg, undefined, cfgElem
        );
        if (block.type === SDFGElementType.SDFGState.toString())
            blockElem.data!.state = block;
        else
            blockElem.data!.block = block;

        blockInfo.label = block.label;
        let blockGraph = null;
        let minWidth = 0;
        if (block.attributes?.possible_reads) {
            const nc = Object.keys(block.attributes.possible_reads).length;
            minWidth = Math.max(
                minWidth,
                nc * CFDataDependencyLense.CONNECTOR_SPACING
            );
        }
        if (block.attributes?.possible_writes) {
            const nc = Object.keys(block.attributes.possible_writes).length;
            minWidth = Math.max(
                minWidth,
                nc * CFDataDependencyLense.CONNECTOR_SPACING
            );
        }
        if (block.attributes?.is_collapsed) {
            blockInfo.height = SDFV.LINEHEIGHT;
            if (blockElem instanceof LoopRegion) {
                const oldFont = ctx.font;
                ctx.font = LoopRegion.LOOP_STATEMENT_FONT;
                const condString = (
                    block.attributes.loop_condition as JsonSDFGCodeBlock |
                    undefined
                )?.string_data ?? '';
                const initString = (
                    block.attributes.init_statement as JsonSDFGCodeBlock |
                    undefined
                )?.string_data ?? '';
                const updateString = (
                    block.attributes.update_statement as JsonSDFGCodeBlock |
                    undefined
                )?.string_data ?? '';
                const labelWidths = [
                    ctx.measureText(condString + 'while').width,
                    ctx.measureText(initString + 'init').width,
                    ctx.measureText(updateString + 'update').width,
                ];
                const maxLabelWidth = Math.max(...labelWidths);
                ctx.font = oldFont;
                blockInfo.width = Math.max(
                    maxLabelWidth, ctx.measureText(block.label).width,
                    minWidth
                ) + 3 * SDFV.LABEL_MARGIN_H;
            } else if (blockElem instanceof ConditionalBlock) {
                const maxLabelWidth = Math.max(...blockElem.branches.map(
                    br => ctx.measureText(
                        br[0] ? (br[0].string_data ?? '') + 'if ' : 'else'
                    ).width
                ));
                blockInfo.width = Math.max(
                    maxLabelWidth, ctx.measureText(block.label).width,
                    minWidth
                ) + 3 * SDFV.LABEL_MARGIN_H;
                blockInfo.height += LoopRegion.CONDITION_SPACING;
            } else {
                blockInfo.width = Math.max(
                    ctx.measureText(blockInfo.label).width, minWidth
                );
            }
        } else {
            if (blockElem instanceof ControlFlowRegion) {
                blockGraph = layoutControlFlowRegion(
                    renderer, block as JsonSDFGControlFlowRegion, blockElem,
                    ctx, cfgList, stateParentList, omitAccessNodes
                );

                const bb = calculateBoundingBox(blockGraph);
                blockInfo.width = Math.max(minWidth, bb.width);
                blockInfo.height = bb.height;
            } else if (blockElem instanceof State) {
                blockGraph = layoutSDFGState(
                    renderer, blockElem, ctx, cfgList, stateParentList,
                    omitAccessNodes
                );

                const bb = calculateBoundingBox(blockGraph);
                blockInfo.width = Math.max(minWidth, bb.width);
                blockInfo.height = bb.height;
            } else if (blockElem instanceof ConditionalBlock) {
                blockGraph = layoutConditionalBlock(
                    renderer, blockElem, ctx, cfgList, stateParentList,
                    omitAccessNodes
                );

                for (const [cond, region] of blockElem.branches) {
                    const condText = cond ?
                        'if ' + (cond.string_data ?? '') : 'else';
                    blockInfo.width += Math.max(
                        region.width, ctx.measureText(condText).width
                    );
                    blockInfo.height = Math.max(
                        blockInfo.height, region.height
                    );
                }
                blockInfo.width = Math.max(minWidth, blockInfo.width);
            }
        }

        if (!(blockElem instanceof ConditionalBlock)) {
            blockInfo.width += 2 * BLOCK_MARGIN;
            blockInfo.height += 2 * BLOCK_MARGIN;
        }

        if (blockElem instanceof LoopRegion) {
            // Add spacing for the condition if the loop is not inverted.
            if (!block.attributes?.inverted)
                blockInfo.height += LoopRegion.CONDITION_SPACING;
            // If there's an init statement, add space for it.
            if (block.attributes?.init_statement)
                blockInfo.height += LoopRegion.INIT_SPACING;
            // If there's an update statement, also add space for it.
            if (block.attributes?.update_statement)
                blockInfo.height += LoopRegion.UPDATE_SPACING;
        } else if (blockElem instanceof ConditionalBlock) {
            blockInfo.height += ConditionalBlock.CONDITION_SPACING;;
        }

        blockElem.data!.layout = blockInfo;
        blockElem.data!.graph = blockGraph;
        blockElem.setLayout();
        g.setNode(block.id.toString(), blockElem);
    }

    for (let id = 0; id < cfg.edges.length; id++) {
        const edge = cfg.edges[id];
        g.setEdge(edge.src, edge.dst, new InterstateEdge(
            renderer, ctx,
            (edge.attributes?.data ?? {}) as Record<string, unknown>,
            id, sdfg, cfg, cfgElem.id, cfgElem,
            edge.src, edge.dst
        ));
    }

    if (SDFVSettings.get<boolean>('useVerticalStateMachineLayout')) {
        // Fall back to dagre for anything that cannot be laid out with
        // the vertical layout (e.g., irreducible control flow).
        try {
            SMLayouter.layoutDagreCompat(g, cfg.start_block.toString());
        } catch (_ignored) {
            dagre.layout(g as unknown as dagre.graphlib.Graph);
        }
    } else {
        dagre.layout(g as unknown as dagre.graphlib.Graph);
    }

    // Annotate the sdfg with its layout info
    for (const block of cfg.nodes) {
        const gnode = g.node(block.id.toString());
        if (gnode) {
            block.attributes ??= {};
            block.attributes.layout = {
                x: gnode.x,
                y: gnode.y,
                width: gnode.width,
                height: gnode.height,
            } as ILayoutAttr;
        }
    }

    for (const edge of cfg.edges) {
        const gedge = g.edge({ v: edge.src, w: edge.dst });
        if (gedge) {
            const bb = calculateEdgeBoundingBox(gedge);
            // Convert from top-left to center
            bb.x += bb.width / 2.0;
            bb.y += bb.height / 2.0;

            gedge.x = bb.x;
            gedge.y = bb.y;
            gedge.width = bb.width;
            gedge.height = bb.height;
            edge.attributes ??= {};
            edge.attributes.layout = {
                width: bb.width,
                height: bb.height,
                x: bb.x,
                y: bb.y,
                points: gedge.points,
            };
        }
    }

    // Offset node and edge locations to be in state margins
    for (let blockId = 0; blockId < cfg.nodes.length; blockId++) {
        const block = cfg.nodes[blockId];
        if (!block.attributes?.is_collapsed) {
            const gBlock = g.node(blockId.toString());
            if (!gBlock)
                continue;
            const topleft = gBlock.topleft();
            if (gBlock instanceof State) {
                offsetSDFGState(gBlock, {
                    x: topleft.x + BLOCK_MARGIN,
                    y: topleft.y + BLOCK_MARGIN,
                });
            } else if (gBlock instanceof ConditionalBlock) {
                offsetConditionalBlock(gBlock, {
                    x: topleft.x,
                    y: topleft.y,
                });
            } else if (gBlock instanceof ControlFlowRegion) {
                // Base spacing for the inside.
                let topSpacing = BLOCK_MARGIN;

                if (gBlock instanceof LoopRegion) {
                    // Add spacing for the condition if the loop isn't inverted.
                    if (!block.attributes?.inverted)
                        topSpacing += LoopRegion.CONDITION_SPACING;
                    // If there's an init statement, add space for it.
                    if (block.attributes?.init_statement)
                        topSpacing += LoopRegion.INIT_SPACING;
                }
                offsetControlFlowRegion(
                    block as JsonSDFGControlFlowRegion, gBlock.graph!, {
                        x: topleft.x + BLOCK_MARGIN,
                        y: topleft.y + topSpacing,
                    }
                );
            }
        }
    }

    const bb = calculateBoundingBox(g);
    g.width = bb.width;
    g.height = bb.height;

    // Add CFG graph to global store.
    if (cfgList !== undefined)
        cfgList[cfg.cfg_list_id].graph = g;

    return g;
}

export function layoutSDFG(
    renderer: SDFGRenderer, sdfg: JsonSDFG, ctx: CanvasRenderingContext2D,
    cfgList?: CFGListType, stateParentList?: SDFGElement[],
    omitAccessNodes: boolean = false
): DagreGraph {
    const sdfgElem = new SDFG(renderer, ctx, sdfg);
    return layoutControlFlowRegion(
        renderer, sdfg, sdfgElem, ctx, cfgList, stateParentList, omitAccessNodes
    );
}
