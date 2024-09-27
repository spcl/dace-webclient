// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import dagre from 'dagre';

import {
    AccessNode,
    calculateBoundingBox,
    calculateEdgeBoundingBox,
    CFGListType,
    check_and_redirect_edge,
    ConditionalBlock,
    Connector,
    ControlFlowRegion,
    DagreGraph,
    deepCopy,
    findExitForEntry,
    intersectRect,
    InterstateEdge,
    JsonSDFG,
    JsonSDFGBlock,
    JsonSDFGConditionalBlock,
    JsonSDFGControlFlowRegion,
    JsonSDFGEdge,
    JsonSDFGNode,
    LoopRegion,
    Memlet,
    NestedSDFG,
    Point2D,
    ScopeNode,
    SDFG,
    sdfg_property_to_string,
    SDFGElements,
    SDFGElementType,
    SDFGNode,
    SDFV,
    Size2D,
    State,
} from '..';
import { SDFVSettings } from '../utils/sdfv_settings';
import { SMLayouter } from './state_machine/sm_layouter';

type CFGBlockInfoT = {
    label?: string,
    width: number,
    height: number,
};

/**
 * Offset a control flow region's contents by a given offset.
 * @param region    Region to offset.
 * @param offs      Offset to move everything by.
 */
function offsetControlFlowRegion(
    cfg: JsonSDFGControlFlowRegion, region: ControlFlowRegion, offs: Point2D
): void {
    cfg.nodes?.forEach((blockJson: JsonSDFGBlock, id: number) => {
        const block = region.data.graph.node(id.toString());
        block.x += offs.x;
        block.y += offs.y;
        if (!block.attributes()?.is_collapsed) {
            if (block instanceof State) {
                offsetSDFGState(block, offs);
            } else if (block instanceof ConditionalBlock) {
                offsetConditionalBlock(block, offs);
            } else if (block instanceof ControlFlowRegion) {
                offsetControlFlowRegion(
                    blockJson as JsonSDFGControlFlowRegion, block, offs
                );
            }
        }
    });
    cfg.edges?.forEach((e: JsonSDFGEdge, _eid: number) => {
        const edge = region.data.graph.edge(e.src, e.dst);
        edge.x += offs.x;
        edge.y += offs.y;
        edge.points.forEach((p: Point2D) => {
            p.x += offs.x;
            p.y += offs.y;
        });
    });
}

/**
 * Offset a conditional block's contents by a given offset.
 * @param block Conditional block to offset.
 * @param offs  Offset by which to move everything.
 */
function offsetConditionalBlock(block: ConditionalBlock, offs: Point2D): void {
    for (let id = 0; id < block.branches.length; id++) {
        const region = block.branches[id][1]
        region.x += offs.x;
        region.y += offs.y;
        if (!region.attributes()?.is_collapsed)
            offsetControlFlowRegion(region.data.block, region, offs);
    }
}

/**
 * Offset an entire SDFG state's contents by a given offset.
 * @param state State to offset.
 * @param offs  Offset by which to move everything.
 */
function offsetSDFGState(state: State, offs: Point2D): void {
    const drawnNodes: Set<string> = new Set();

    state.data.state.nodes.forEach((_n: JsonSDFGNode, nid: number) => {
        const node = state.data.graph.node(nid);
        if (!node)
            return;
        drawnNodes.add(nid.toString());

        node.x += offs.x;
        node.y += offs.y;
        node.in_connectors.forEach((c: Connector) => {
            c.x += offs.x;
            c.y += offs.y;
        });
        node.out_connectors.forEach((c: Connector) => {
            c.x += offs.x;
            c.y += offs.y;
        });

        if (node instanceof NestedSDFG && node.data.node.attributes.sdfg)
            offsetControlFlowRegion(node.data.node.attributes.sdfg, node, offs);
    });
    state.data.state.edges.forEach((e: JsonSDFGEdge, eid: number) => {
        const ne = check_and_redirect_edge(e, drawnNodes, state.data.state);
        if (!ne)
            return;
        e = ne;
        const edge = state.data.graph.edge(e.src, e.dst, eid);
        if (!edge)
            return;
        edge.x += offs.x;
        edge.y += offs.y;
        edge.points.forEach((p: Point2D) => {
            p.x += offs.x;
            p.y += offs.y;
        });
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
    let label;
    switch (node.type) {
        case SDFGElementType.AccessNode:
            label = node.label;
            if (SDFVSettings.get<boolean>('showDataDescriptorSizes')) {
                const nodedesc = sdfg.attributes._arrays[label];
                if (nodedesc && nodedesc.attributes.shape) {
                    label = ' ' + sdfg_property_to_string(
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
        node.attributes.layout.in_connectors
    ).length - SDFV.LINEHEIGHT;
    const outconnsize = 2 * SDFV.LINEHEIGHT * Object.keys(
        node.attributes.layout.out_connectors
    ).length - SDFV.LINEHEIGHT;
    const maxwidth = Math.max(labelsize, inconnsize, outconnsize);
    let maxheight = 2 * SDFV.LINEHEIGHT;
    maxheight += 4 * SDFV.LINEHEIGHT;

    const size: Size2D = { w: maxwidth, h: maxheight };

    // add something to the size based on the shape of the node
    switch (node.type) {
        case SDFGElementType.AccessNode:
            size.h -= 4 * SDFV.LINEHEIGHT;
            size.w += size.h;
            break;
        case SDFGElementType.MapEntry:
        case SDFGElementType.ConsumeEntry:
        case SDFGElementType.PipelineEntry:
        case SDFGElementType.MapExit:
        case SDFGElementType.ConsumeExit:
        case SDFGElementType.PipelineExit:
            size.w += 2.0 * size.h;
            size.h /= 1.75;
            break;
        case SDFGElementType.Tasklet:
            size.w += 2.0 * (size.h / 3.0);
            size.h /= 1.75;
            break;
        case SDFGElementType.LibraryNode:
            size.w += 2.0 * (size.h / 3.0);
            size.h /= 1.75;
            break;
        case SDFGElementType.Reduce:
            size.h -= 4 * SDFV.LINEHEIGHT;
            size.w *= 2;
            size.h = size.w / 3.0;
            break;
    }

    return size;
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
    node: JsonSDFGNode, state: State, graph: DagreGraph,
    hiddenNodes: Map<string, any>, drawnNodes: Set<string>,
    ctx?: CanvasRenderingContext2D, cfgList?: CFGListType,
    stateParentList?: any[], omitAccessNodes: boolean = false
): void {
    if (omitAccessNodes && node.type === SDFGElementType.AccessNode) {
        // Add access node to hidden nodes; source and destinations will be
        // set later.
        hiddenNodes.set(
            node.id.toString(), { node: node, src: null, dsts: [] }
        );
        return;
    }

    let nestedGraph = null;
    node.attributes.layout = {};

    // Set connectors prior to computing node size
    node.attributes.layout.in_connectors =
        node.attributes.in_connectors ?? [];
    if ('is_collapsed' in node.attributes && node.attributes.is_collapsed &&
        node.type !== SDFGElementType.NestedSDFG &&
        node.type !== SDFGElementType.ExternalNestedSDFG) {
        node.attributes.layout.out_connectors = findExitForEntry(
            state.data.state.nodes, node
        )?.attributes.out_connectors ?? [];
    } else {
        node.attributes.layout.out_connectors =
            node.attributes.out_connectors ?? [];
    }

    const nodeSize = calculateDFNodeSize(state.sdfg, node, ctx);
    node.attributes.layout.width = nodeSize.w;
    node.attributes.layout.height = nodeSize.h;
    node.attributes.layout.label = node.label;

    // Recursively lay out nested SDFGs.
    if (node.type === SDFGElementType.NestedSDFG ||
        node.type === SDFGElementType.ExternalNestedSDFG) {
        if (node.attributes.sdfg &&
            node.attributes.sdfg.type !== 'SDFGShell') {
            nestedGraph = layoutControlFlowRegion(
                node.attributes.sdfg, state, ctx, cfgList, stateParentList,
                omitAccessNodes
            );
            const sdfgInfo = calculateBoundingBox(nestedGraph);
            node.attributes.layout.width =
                sdfgInfo.width + 2 * SDFV.LINEHEIGHT;
            node.attributes.layout.height =
                sdfgInfo.height + 2 * SDFV.LINEHEIGHT;
        } else {
            const emptyNSDFGLabel = 'No SDFG loaded';
            if (ctx) {
                const textMetrics = ctx.measureText(emptyNSDFGLabel);
                node.attributes.layout.width =
                    textMetrics.width + 2 * SDFV.LINEHEIGHT;
            } else {
                node.attributes.layout.width = 1;
            }
            node.attributes.layout.height = 4 * SDFV.LINEHEIGHT;
        }
    }

    // Dynamically create node type.
    const obj = new SDFGElements[node.type](
        { node: node, graph: nestedGraph }, node.id, state.sdfg, state.cfg,
        state.id, state
    );

    // If it's a nested SDFG, we need to record the node as all of its
    // state's parent node.
    if ((node.type === SDFGElementType.NestedSDFG ||
        node.type === SDFGElementType.ExternalNestedSDFG) &&
        node.attributes.sdfg && node.attributes.sdfg.type !== 'SDFGShell' &&
        stateParentList !== undefined && cfgList !== undefined
    ) {
        stateParentList[node.attributes.sdfg.cfg_list_id] = obj;
        cfgList[node.attributes.sdfg.cfg_list_id].nsdfgNode = obj;
    }

    // Add input connectors.
    let i = 0;
    let conns;
    if (Array.isArray(node.attributes.layout.in_connectors))
        conns = node.attributes.layout.in_connectors;
    else
        conns = Object.keys(node.attributes.layout.in_connectors);
    for (const cname of conns) {
        const conn = new Connector(
            { name: cname }, i, state.sdfg, state.cfg, node.id, obj
        );
        conn.connectorType = 'in';
        conn.linkedElem = obj;
        obj.in_connectors.push(conn);
        i += 1;
    }

    // Add output connectors -- if collapsed, uses exit node connectors.
    i = 0;
    if (Array.isArray(node.attributes.layout.out_connectors))
        conns = node.attributes.layout.out_connectors;
    else
        conns = Object.keys(node.attributes.layout.out_connectors);
    for (const cname of conns) {
        const conn = new Connector(
            { name: cname }, i, state.sdfg, state.cfg, node.id, obj
        );
        conn.connectorType = 'out';
        conn.linkedElem = obj;
        obj.out_connectors.push(conn);
        i += 1;
    }

    // Add nodes to the graph. The first argument is the node id. The
    // second is metadata about the node (label, width, height),
    // which will be updated by dagre.layout (will add x,y).
    graph.setNode(node.id.toString(), obj);
    drawnNodes.add(node.id.toString());

    // Recursively draw nodes.
    if (node.id in state.data.state.scope_dict) {
        if (node.attributes.is_collapsed)
            return;
        state.data.state.scope_dict[node.id].forEach((nodeid: number) => {
            const node = state.data.state.nodes[nodeid];
            layoutDFNode(
                node, state, graph, hiddenNodes, drawnNodes, ctx,
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
    state: State, ctx?: CanvasRenderingContext2D, cfgList?: CFGListType,
    stateParentList?: any[], omitAccessNodes: boolean = false
): DagreGraph {
    const stateJson = state.data.state;

    // layout the sdfg block as a dagre graph.
    const g: DagreGraph = new dagre.graphlib.Graph({ multigraph: true });

    if (!stateJson.nodes && !stateJson.edges)
        return g;

    // Set layout options and a simpler algorithm for large graphs.
    const layoutOptions: any = { ranksep: SDFVSettings.get<number>('ranksep') };
    if (stateJson.nodes.length >= 1000)
        layoutOptions.ranker = 'longest-path';

    layoutOptions.nodesep = SDFVSettings.get<number>('nodesep');
    g.setGraph(layoutOptions);

    // Set an object for the graph label.
    g.setDefaultEdgeLabel(() => {
        return {};
    });

    // Recursively process (i.e., lay out) all nodes of the state and add them
    // to the graph.
    let topLevelNodes = stateJson.scope_dict[-1];
    if (topLevelNodes === undefined)
        topLevelNodes = Object.keys(stateJson.nodes);
    const drawnNodes: Set<string> = new Set();
    const hiddenNodes = new Map();
    topLevelNodes.forEach((nodeid: number) => {
        const node = stateJson.nodes[nodeid];
        layoutDFNode(
            node, state, g, hiddenNodes, drawnNodes, ctx, cfgList,
            stateParentList, omitAccessNodes
        );
    });

    // Add info to calculate shortcut edges.
    function addEdgeInfoIfHidden(edge: any) {
        const hiddenSrc = hiddenNodes.get(edge.src);
        const hiddenDst = hiddenNodes.get(edge.dst);

        if (hiddenSrc && hiddenDst) {
            // If we have edges from an AccessNode to an AccessNode then just
            // connect destinations.
            hiddenSrc.dsts = hiddenDst.dsts;
            edge.attributes.data.attributes.shortcut = false;
        } else if (hiddenSrc) {
            // If edge starts at hidden node, then add it as destination.
            hiddenSrc.dsts.push(edge);
            edge.attributes.data.attributes.shortcut = false;
            return true;
        } else if (hiddenDst) {
            // If edge ends at hidden node, then add it as source.
            hiddenDst.src = edge;
            edge.attributes.data.attributes.shortcut = false;
            return true;
        }

        // If it is a shortcut edge, but we don't omit access nodes, then ignore
        // this edge.
        if (!omitAccessNodes && edge.attributes.data.attributes.shortcut)
            return true;

        return false;
    }

    stateJson.edges.forEach((edge: any, id: any) => {
        if (addEdgeInfoIfHidden(edge))
            return;
        edge = check_and_redirect_edge(edge, drawnNodes, stateJson);

        if (!edge)
            return;

        const e = new Memlet(
            edge.attributes.data, id, state.sdfg, state.cfg, state.id, state
        );
        edge.attributes.data.edge = e;
        (e as any).src_connector = edge.src_connector;
        (e as any).dst_connector = edge.dst_connector;
        g.setEdge(edge.src, edge.dst, e, id);
    });

    hiddenNodes.forEach(hiddenNode => {
        if (hiddenNode.src) {
            hiddenNode.dsts.forEach((e: any) => {
                // Create shortcut edge with new destination.
                const tmpEdge = e.attributes.data.edge;
                e.attributes.data.edge = null;
                const shortCutEdge = deepCopy(e);
                e.attributes.data.edge = tmpEdge;
                shortCutEdge.src = hiddenNode.src.src;
                shortCutEdge.src_connector = hiddenNode.src.src_connector;
                shortCutEdge.dst_connector = e.dst_connector;
                // Attribute that only shortcut edges have; if it is explicitly
                // false, then edge is ignored in omit access node mode.
                shortCutEdge.attributes.data.attributes.shortcut = true;

                // Draw the redirected edge.
                const redirectedEdge = check_and_redirect_edge(
                    shortCutEdge, drawnNodes, stateJson
                );
                if (!redirectedEdge)
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
                    deepCopy(redirectedEdge.attributes.data), edgeId,
                    state.sdfg, state.cfg, stateJson.id
                );
                (newShortCutEdge as any).src_connector =
                    redirectedEdge.src_connector;
                (newShortCutEdge as any).dst_connector =
                    redirectedEdge.dst_connector;
                newShortCutEdge.data.attributes.shortcut = true;

                g.setEdge(
                    redirectedEdge.src, redirectedEdge.dst, newShortCutEdge,
                    edgeId.toString()
                );
            });
        }
    });

    dagre.layout(g);

    // Layout connectors and nested SDFGs.
    stateJson.nodes.forEach((node: JsonSDFGNode, id: number) => {
        const gnode: any = g.node(id.toString());
        if (!gnode || (omitAccessNodes && gnode instanceof AccessNode)) {
            // Ignore nodes that should not be drawn.
            return;
        }
        const topleft = gnode.topleft();

        // Offset nested SDFG.
        if (node.type === SDFGElementType.NestedSDFG && node.attributes.sdfg) {
            offsetControlFlowRegion(node.attributes.sdfg, gnode, {
                x: topleft.x + SDFV.LINEHEIGHT,
                y: topleft.y + SDFV.LINEHEIGHT,
            });
        }
        // Write back layout information.
        node.attributes.layout.x = gnode.x;
        node.attributes.layout.y = gnode.y;
        // Connector management.
        const SPACING = SDFV.LINEHEIGHT;
        const iConnLength = (SDFV.LINEHEIGHT + SPACING) * Object.keys(
            node.attributes.layout.in_connectors
        ).length - SPACING;
        const oConnLength = (SDFV.LINEHEIGHT + SPACING) * Object.keys(
            node.attributes.layout.out_connectors
        ).length - SPACING;
        let iConnX = gnode.x - iConnLength / 2.0 + SDFV.LINEHEIGHT / 2.0;
        let oConnX = gnode.x - oConnLength / 2.0 + SDFV.LINEHEIGHT / 2.0;

        for (const c of gnode.in_connectors) {
            c.width = SDFV.LINEHEIGHT;
            c.height = SDFV.LINEHEIGHT;
            c.x = iConnX;
            iConnX += SDFV.LINEHEIGHT + SPACING;
            c.y = topleft.y;
        }
        for (const c of gnode.out_connectors) {
            c.width = SDFV.LINEHEIGHT;
            c.height = SDFV.LINEHEIGHT;
            c.x = oConnX;
            oConnX += SDFV.LINEHEIGHT + SPACING;
            c.y = topleft.y + gnode.height;
        }
    });

    // Re-order in_connectors for the edges to not intertwine
    stateJson.nodes.forEach((node: JsonSDFGNode, id: number) => {
        const gnode: any = g.node(id.toString());
        if (!gnode || (omitAccessNodes && gnode instanceof AccessNode)) {
            // Ignore nodes that should not be drawn.
            return;
        }

        // Summarize edges for NestedSDFGs and ScopeNodes
        if (SDFVSettings.get<boolean>('summarizeLargeNumbersOfEdges')) {
            if (gnode instanceof NestedSDFG || gnode instanceof ScopeNode) {
                const n_of_in_connectors = gnode.in_connectors.length;
                const n_of_out_connectors = gnode.out_connectors.length;

                if (n_of_in_connectors > 10) {
                    gnode.summarize_in_edges = true;
                    gnode.in_summary_has_effect = true;
                }
                if (n_of_out_connectors > 10) {
                    gnode.summarize_out_edges = true;
                    gnode.out_summary_has_effect = true;
                }
            }
        }
        const SPACING = SDFV.LINEHEIGHT;
        const iConnLength = (SDFV.LINEHEIGHT + SPACING) * Object.keys(
            node.attributes.layout.in_connectors
        ).length - SPACING;
        let iConnX = gnode.x - iConnLength / 2.0 + SDFV.LINEHEIGHT / 2.0;

        // Dictionary that saves the x coordinates of each connector's source
        // node or source connector. This is later used to reorder the
        // in_connectors based on the sources' x coordinates.
        const sources_x_coordinates: { [key: string]: number } = {};

        // For each in_connector, find the x coordinate of the source node
        // connector.
        for (const c of gnode.in_connectors) {
            stateJson.edges.forEach((edge: JsonSDFGEdge, id: number) => {
                if (edge.dst === gnode.id.toString() &&
                    edge.dst_connector === c.data.name) {
                    // If in-edges are to be summarized, set Memlet.summarized
                    const gedge = g.edge(
                        edge.src, edge.dst, id.toString()
                    ) as Memlet;
                    if (gedge && gnode.summarize_in_edges)
                        gedge.summarized = true;

                    const source_node: SDFGNode = g.node(edge.src);
                    if (source_node) {
                        // If source node doesn't have out_connectors, take
                        // the source node's own x coordinate
                        if (source_node.out_connectors.length === 0) {
                            sources_x_coordinates[c.data.name] = source_node.x;
                        } else {
                            // Find the corresponding out_connector and take its
                            // x coordinate.
                            const nOutConn = source_node.out_connectors.length;
                            for (let i = 0; i < nOutConn; ++i) {
                                if (source_node.out_connectors[i].data.name ===
                                    edge.src_connector) {
                                    sources_x_coordinates[c.data.name] =
                                        source_node.out_connectors[i].x;
                                    break;
                                }
                            }
                        }
                    }
                }
            });
        }

        // Sort the dictionary by x coordinate values
        const sources_x_coordinates_sorted = Object.entries(
            sources_x_coordinates
        );
        sources_x_coordinates_sorted.sort((a, b) => a[1] - b[1]);

        // In the order of the sorted source x coordinates, set the x
        // coordinates of the in_connectors.
        for (const element of sources_x_coordinates_sorted) {
            for (const c of gnode.in_connectors) {
                if (c.data.name === element[0]) {
                    c.x = iConnX;
                    iConnX += SDFV.LINEHEIGHT + SPACING;
                    continue;
                }
            }
        }

        // For out_connectors set Memlet.summarized for all out-edges if needed
        if (gnode.summarize_out_edges) {
            for (const c of gnode.out_connectors) {
                stateJson.edges.forEach((edge: JsonSDFGEdge, id: number) => {
                    if (edge.src === gnode.id.toString() &&
                        edge.src_connector === c.data.name) {
                        const gedge = g.edge(
                            edge.src, edge.dst, id.toString()
                        ) as Memlet;
                        if (gedge)
                            gedge.summarized = true;
                    }
                });
            }
        }
    });

    stateJson.edges.forEach((edge: JsonSDFGEdge, id: number) => {
        const nedge = check_and_redirect_edge(edge, drawnNodes, stateJson);
        if (!nedge)
            return;
        edge = nedge;
        const gedge = g.edge(edge.src, edge.dst, id.toString());
        if (!gedge || (omitAccessNodes &&
            gedge.data.attributes.shortcut === false ||
            !omitAccessNodes && gedge.data.attributes.shortcut)) {
            // If access nodes omitted, don't draw non-shortcut edges and
            // vice versa.
            return;
        }

        // Reposition first and last points according to connectors.
        let srcConn = null;
        let dstConn = null;
        if (edge.src_connector) {
            const src_node: SDFGNode = g.node(edge.src);
            let cindex = -1;
            for (let i = 0; i < src_node.out_connectors.length; i++) {
                if (
                    src_node.out_connectors[i].data.name === edge.src_connector
                ) {
                    cindex = i;
                    break;
                }
            }
            if (cindex >= 0) {
                gedge.points[0].x = src_node.out_connectors[cindex].x;
                gedge.points[0].y = src_node.out_connectors[cindex].y;
                srcConn = src_node.out_connectors[cindex];
            }
        }
        if (edge.dst_connector) {
            const dstNode: SDFGNode = g.node(edge.dst);
            let cindex = -1;
            for (let i = 0; i < dstNode.in_connectors.length; i++) {
                const c = dstNode.in_connectors[i];
                if (c.data.name === edge.dst_connector) {
                    cindex = i;
                    break;
                }
            }
            if (cindex >= 0) {
                gedge.points[gedge.points.length - 1].x =
                    dstNode.in_connectors[cindex].x;
                gedge.points[gedge.points.length - 1].y =
                    dstNode.in_connectors[cindex].y;
                dstConn = dstNode.in_connectors[cindex];
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
        (bb as any).x += bb.width / 2.0;
        (bb as any).y += bb.height / 2.0;

        edge.width = bb.width;
        edge.height = bb.height;
        edge.x = (bb as any).x;
        edge.y = (bb as any).y;
        gedge.width = bb.width;
        gedge.height = bb.height;
        gedge.x = (bb as any).x;
        gedge.y = (bb as any).y;
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
    condBlockElem: ConditionalBlock,
    ctx?: CanvasRenderingContext2D, cfgList?: CFGListType,
    stateParentList?: any[], omitAccessNodes: boolean = false
): DagreGraph {
    const BLOCK_MARGIN = 3 * SDFV.LINEHEIGHT;
    const sdfg = condBlockElem.sdfg;
    const condBlock = condBlockElem.data.block;

    // Layout the state machine as a dagre graph.
    const g: DagreGraph = new dagre.graphlib.Graph();
    g.setGraph({});
    g.setDefaultEdgeLabel(() => {
        return {};
    });

    // layout each block individually to get its size.
    let offsetAmount = 0;
    for (let id = 0; id < condBlock.branches.length; id++) {
        const [condition, block] = condBlock.branches[id];
        block.id = id;
        let blockInfo: CFGBlockInfoT = {
            label: undefined,
            width: 0,
            height: 0,
        };
        const blockEl = new ControlFlowRegion(
            { layout: { width: 0, height: 0 } }, block.id, sdfg, null,
            null, condBlockElem
        );
        g.setNode(block.id.toString(), blockEl);
        blockEl.data.block = block;
        condBlockElem.branches.push([condition, blockEl]);

        blockInfo.label = block.id.toString();
        if (block.attributes?.is_collapsed) {
            blockInfo.width = ctx?.measureText(
                condition?.string_data ?? 'else'
            ).width ?? 0;
            blockInfo.height = SDFV.LINEHEIGHT;
        } else {
            const blockGraph = layoutControlFlowRegion(
                block, blockEl, ctx, cfgList, stateParentList, omitAccessNodes
            );
            const bb = calculateBoundingBox(blockGraph);
            blockInfo.width = bb.width
            blockInfo.height = bb.height;
            blockEl.data.graph = blockGraph;
        }

        blockInfo.width += 2 * BLOCK_MARGIN;
        blockInfo.height += 2 * BLOCK_MARGIN;
        blockEl.data.layout = blockInfo;
        blockEl.set_layout();

        blockEl.y = (
            condBlockElem.y + (blockInfo.height / 2) +
            ConditionalBlock.CONDITION_SPACING
        );
        blockEl.x = condBlockElem.x + (blockInfo.width / 2) + offsetAmount;
        if (!blockEl.attributes()?.is_collapsed) {
            offsetControlFlowRegion(block, blockEl, {
                x: offsetAmount + BLOCK_MARGIN,
                y: BLOCK_MARGIN + ConditionalBlock.CONDITION_SPACING,
            });
        }

        offsetAmount += blockInfo.width;
    }

    // Annotate the JSON with layout information
    for (const [_, branch] of condBlock.branches) {
        const gnode = g.node(branch.id.toString());
        if (!branch.attributes)
            branch.attributes = {};
        branch.attributes.layout = {};
        branch.attributes.layout.x = gnode.x;
        branch.attributes.layout.y = gnode.y;
        branch.attributes.layout.width = gnode.width;
        branch.attributes.layout.height = gnode.height;
    }

    return g
}

function layoutControlFlowRegion(
    cfg: JsonSDFGControlFlowRegion, cfgElem: ControlFlowRegion,
    ctx?: CanvasRenderingContext2D, cfgList?: CFGListType,
    stateParentList?: any[], omitAccessNodes: boolean = false
): DagreGraph {
    const BLOCK_MARGIN = 3 * SDFV.LINEHEIGHT;
    const sdfg = cfgElem.sdfg;

    // Layout the state machine as a dagre graph.
    const g: DagreGraph = new dagre.graphlib.Graph();
    g.setGraph({});
    g.setDefaultEdgeLabel(() => {
        return {};
    });

    // layout each block individually to get its size.
    for (const block of cfg.nodes) {
        const blockInfo: CFGBlockInfoT = {
            label: undefined,
            width: 0,
            height: 0,
        };

        const blockElem = new SDFGElements[block.type](
            { layout: { width: 0, height: 0 } }, block.id, sdfg, cfg,
            null, cfgElem
        );
        if (block.type === SDFGElementType.SDFGState)
            blockElem.data.state = block;
        else
            blockElem.data.block = block;

        blockInfo.label = block.id.toString();
        let blockGraph = null;
        if (block.attributes?.is_collapsed) {
            blockInfo.height = SDFV.LINEHEIGHT;
            if (blockElem instanceof LoopRegion && ctx) {
                const oldFont = ctx.font;
                ctx.font = LoopRegion.LOOP_STATEMENT_FONT;
                const labelWidths = [
                    ctx.measureText(
                        (block.attributes.scope_condition?.string_data ?? '') +
                        'while'
                    ).width,
                    ctx.measureText(
                        (block.attributes.init_statement?.string_data ?? '') +
                        'init'
                    ).width,
                    ctx.measureText(
                        (block.attributes.update_statement?.string_data ?? '') +
                        'update'
                    ).width,
                ];
                const maxLabelWidth = Math.max(...labelWidths);
                ctx.font = oldFont;
                blockInfo.width = Math.max(
                    maxLabelWidth, ctx.measureText(block.label).width
                ) + 3 * LoopRegion.META_LABEL_MARGIN;
            } else if (blockElem instanceof ConditionalBlock && ctx) {
                const maxLabelWidth = Math.max(...blockElem.branches.map(
                    br => ctx.measureText(
                        br[0] ? br[0].string_data + 'if ' : 'else'
                    ).width
                ));
                blockInfo.width = Math.max(
                    maxLabelWidth, ctx.measureText(block.label).width
                ) + 3 * LoopRegion.META_LABEL_MARGIN;
                blockInfo.height += LoopRegion.CONDITION_SPACING;
            } else {
                if (ctx)
                    blockInfo.width = ctx.measureText(blockInfo.label).width;
                else
                    blockInfo.width = 1;
            }
        } else {
            if (blockElem instanceof ControlFlowRegion) {
                blockGraph = layoutControlFlowRegion(
                    block as JsonSDFGControlFlowRegion, blockElem, ctx,
                    cfgList, stateParentList, omitAccessNodes
                );

                const bb = calculateBoundingBox(blockGraph);
                blockInfo.width = bb.width;
                blockInfo.height = bb.height;
            } else if (blockElem instanceof State) {
                blockGraph = layoutSDFGState(
                    blockElem, ctx, cfgList, stateParentList, omitAccessNodes
                );

                const bb = calculateBoundingBox(blockGraph);
                blockInfo.width = bb.width;
                blockInfo.height = bb.height;
            } else if (blockElem instanceof ConditionalBlock) {
                blockGraph = layoutConditionalBlock(
                    blockElem, ctx, cfgList, stateParentList, omitAccessNodes
                )

                for (const [cond, region] of blockElem.branches) {
                    const condText = cond ? 'if ' + cond.string_data : 'else';
                    blockInfo.width += Math.max(
                        region.width, ctx?.measureText(condText).width ?? 0
                    );
                    blockInfo.height = Math.max(
                        blockInfo.height, region.height
                    );
                }
            }
        }

        if (!(blockElem instanceof ConditionalBlock)) {
            blockInfo.width += 2 * BLOCK_MARGIN;
            blockInfo.height += 2 * BLOCK_MARGIN;
        }

        if (blockElem instanceof LoopRegion) {
            // Add spacing for the condition if the loop is not inverted.
            if (!block.attributes.inverted)
                blockInfo.height += LoopRegion.CONDITION_SPACING;
            // If there's an init statement, add space for it.
            if (block.attributes.init_statement)
                blockInfo.height += LoopRegion.INIT_SPACING;
            // If there's an update statement, also add space for it.
            if (block.attributes.update_statement)
                blockInfo.height += LoopRegion.UPDATE_SPACING;
        } else if (blockElem instanceof ConditionalBlock) {
            blockInfo.height += ConditionalBlock.CONDITION_SPACING;;
        }

        blockElem.data.layout = blockInfo;
        blockElem.data.graph = blockGraph;
        blockElem.set_layout();
        g.setNode(block.id.toString(), blockElem);
    }

    for (let id = 0; id < cfg.edges.length; id++) {
        const edge = cfg.edges[id];
        g.setEdge(edge.src, edge.dst, new InterstateEdge(
            edge.attributes.data, id, sdfg, cfg, cfgElem.id, cfgElem,
            edge.src, edge.dst
        ));
    }

    if (SDFVSettings.get<boolean>('useVerticalStateMachineLayout')) {
        // Fall back to dagre for anything that cannot be laid out with
        // the vertical layout (e.g., irreducible control flow).
        try {
            SMLayouter.layoutDagreCompat(g, sdfg.start_block?.toString());
        } catch (_ignored) {
            dagre.layout(g);
        }
    } else {
        dagre.layout(g);
    }

    // Annotate the sdfg with its layout info
    for (const block of cfg.nodes) {
        const gnode = g.node(block.id.toString());
        if (!block.attributes)
            block.attributes = {};
        block.attributes.layout = {};
        block.attributes.layout.x = gnode.x;
        block.attributes.layout.y = gnode.y;
        block.attributes.layout.width = gnode.width;
        block.attributes.layout.height = gnode.height;
    }

    for (const edge of cfg.edges) {
        const gedge = g.edge(edge.src, edge.dst);
        const bb = calculateEdgeBoundingBox(gedge);
        // Convert from top-left to center
        (bb as any).x += bb.width / 2.0;
        (bb as any).y += bb.height / 2.0;

        gedge.x = (bb as any).x;
        gedge.y = (bb as any).y;
        gedge.width = bb.width;
        gedge.height = bb.height;
        edge.attributes.layout = {};
        edge.attributes.layout.width = bb.width;
        edge.attributes.layout.height = bb.height;
        edge.attributes.layout.x = (bb as any).x;
        edge.attributes.layout.y = (bb as any).y;
        edge.attributes.layout.points = gedge.points;
    }

    // Offset node and edge locations to be in state margins
    for (let blockId = 0; blockId < cfg.nodes.length; blockId++) {
        const block = cfg.nodes[blockId];
        if (!block.attributes.is_collapsed) {
            const gBlock: any = g.node(blockId.toString());
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
                       if (!block.attributes.inverted)
                        topSpacing += LoopRegion.CONDITION_SPACING;
                    // If there's an init statement, add space for it.
                    if (block.attributes.init_statement)
                        topSpacing += LoopRegion.INIT_SPACING;
                }
                offsetControlFlowRegion(block as any, gBlock, {
                    x: topleft.x + BLOCK_MARGIN,
                    y: topleft.y + topSpacing,
                });
            }
        }
    }

    const bb = calculateBoundingBox(g);
    (g as any).width = bb.width;
    (g as any).height = bb.height;

    // Add CFG graph to global store.
    if (cfgList !== undefined)
        cfgList[cfg.cfg_list_id].graph = g;

    return g;
}

export function layoutSDFG(
    sdfg: JsonSDFG, ctx?: CanvasRenderingContext2D,
    cfgList?: CFGListType, stateParentList?: any[],
    omitAccessNodes: boolean = false
): DagreGraph {
    const sdfgElem = new SDFG(sdfg);
    return layoutControlFlowRegion(
        sdfg, sdfgElem, ctx, cfgList, stateParentList, omitAccessNodes
    );
}
