/* eslint-disable */

import { RenderGraph } from "../../../../../layouting/layoutLib";
import { LINEHEIGHT, STATE_MARGIN } from "../../../../../utils/constants";
import { deepCopy } from "../../../../../utils/utils";
import { check_and_redirect_edge, find_exit_for_entry } from "../../../../../utils/sdfg/sdfg_utils";
import { Connector, Edge, SDFGElements, State } from "../../../../renderer_elements";
import { getTextMetrics } from "../../render_layout_element";

export function getSDFGGraph(sdfg, sdfg_list, state_parent_list, omit_access_nodes) {
    const g = new RenderGraph();

    // layout each state to get its size
    sdfg.nodes.forEach((state) => {
        const stateinfo = {};

        stateinfo.label = `${state.id}`;
        let state_g = null;
        stateinfo.width = getTextMetrics(stateinfo.label).width;
        stateinfo.height = LINEHEIGHT;
        if (!state.attributes.is_collapsed) {
            state_g = get_state_graph(state, sdfg, sdfg_list,
                state_parent_list, omit_access_nodes);
        }
        stateinfo.width += 2 * STATE_MARGIN;
        stateinfo.height += 2 * STATE_MARGIN;
        const state_obj = new State({
            state: state,
            layout: stateinfo,
            graph: state_g
        }, state.id, sdfg);
        state_obj.childGraph = state_g;
        g.addNode(state_obj, parseInt(state.id));
    });

    sdfg.edges.forEach((edge, id) => {
        const edge_obj = new Edge(edge.attributes.data, id, sdfg);
        edge_obj.src = parseInt(edge.src);
        edge_obj.dst = parseInt(edge.dst);
        edge_obj.srcConnector = null;
        edge_obj.dstConnector = null;
        g.addEdge(edge_obj, id);
    });

    return g;
}

function get_state_graph(sdfg_state, sdfg, sdfg_list, state_parent_list, omit_access_nodes) {
    // layout the state as a render graph
    const g = new RenderGraph();

    // Add nodes to the graph. The first argument is the node id. The
    // second is metadata about the node (label, width, height),
    // which will be updated by dagre.layout (will add x,y).

    // Process nodes hierarchically
    let toplevel_nodes = sdfg_state.scope_dict[-1];
    if (toplevel_nodes === undefined)
        toplevel_nodes = Object.keys(sdfg_state.nodes);
    g.drawn_nodes = new Set();
    const hidden_nodes = new Map();

    function layout_node(node) {
        if (omit_access_nodes && node.type == 'AccessNode') {
            // add access node to hidden nodes; source and destinations will be set later
            hidden_nodes.set(node.id.toString(), { node: node, src: null, dsts: [] });
            return;
        }

        let nested_g = null;
        node.attributes.layout = {};

        // Set connectors prior to computing node size
        node.attributes.layout.in_connectors = node.attributes.in_connectors;
        if ('is_collapsed' in node.attributes && node.attributes.is_collapsed && node.type !== 'NestedSDFG')
            node.attributes.layout.out_connectors = find_exit_for_entry(sdfg_state.nodes, node).attributes.out_connectors;
        else
            node.attributes.layout.out_connectors = node.attributes.out_connectors;

        const nodesize = calculateNodeSize(sdfg_state, node);
        node.attributes.layout.width = nodesize.width;
        node.attributes.layout.height = nodesize.height;
        node.attributes.layout.label = node.label;

        // Recursively add nested SDFGs
        if (node.type === 'NestedSDFG' && !node.attributes.is_collapsed) {
            nested_g = getSDFGGraph(node.attributes.sdfg, sdfg_list, state_parent_list, omit_access_nodes);
        }

        // Dynamically create node type
        const obj = new SDFGElements[node.type]({ node: node, graph: nested_g }, node.id, sdfg, sdfg_state.id);

        // If it's a nested SDFG, we need to record the node as all of its
        // state's parent node
        if (node.type === 'NestedSDFG')
            state_parent_list[node.attributes.sdfg.sdfg_list_id] = obj;

        // Add input connectors
        let i = 0;
        let conns;
        if (Array.isArray(node.attributes.layout.in_connectors))
            conns = node.attributes.layout.in_connectors;
        else
            conns = Object.keys(node.attributes.layout.in_connectors);
        for (const cname of conns) {
            const conn = new Connector({ name: cname }, i, sdfg, node.id);
            obj.inConnectors.push(conn);
            i += 1;
        }

        // Add output connectors -- if collapsed, uses exit node connectors
        i = 0;
        if (Array.isArray(node.attributes.layout.out_connectors))
            conns = node.attributes.layout.out_connectors;
        else
            conns = Object.keys(node.attributes.layout.out_connectors);
        for (const cname of conns) {
            const conn = new Connector({ name: cname }, i, sdfg, node.id);
            obj.outConnectors.push(conn);
            i += 1;
        }

        g.addNode(obj, node.id);
        g.drawn_nodes.add(node.id.toString());

        // Recursively draw nodes
        if (node.id in sdfg_state.scope_dict) {
            if (node.attributes.is_collapsed)
                return;
            sdfg_state.scope_dict[node.id].forEach((nodeid) => {
                const node = sdfg_state.nodes[nodeid];
                layout_node(node);
            });
        }
    }


    toplevel_nodes.forEach((nodeid) => {
        const node = sdfg_state.nodes[nodeid];
        layout_node(node);
    });

    // add info to calculate shortcut edges
    function add_edge_info_if_hidden(edge) {
        const hidden_src = hidden_nodes.get(edge.src);
        const hidden_dst = hidden_nodes.get(edge.dst);

        if (hidden_src && hidden_dst) {
            // if we have edges from an AccessNode to an AccessNode then just connect destinations
            hidden_src.dsts = hidden_dst.dsts;
            edge.attributes.data.attributes.shortcut = false;
        } else if (hidden_src) {
            // if edge starts at hidden node, then add it as destination
            hidden_src.dsts.push(edge);
            edge.attributes.data.attributes.shortcut = false;
            return true;
        } else if (hidden_dst) {
            // if edge ends at hidden node, then add it as source
            hidden_dst.src = edge;
            edge.attributes.data.attributes.shortcut = false;
            return true;
        }

        // if it is a shortcut edge, but we don't omit access nodes, then ignore this edge
        if (!omit_access_nodes && edge.attributes.data.attributes.shortcut) return true;

        return false;
    }

    sdfg_state.edges.forEach((edge, id) => {
        if (add_edge_info_if_hidden(edge)) return;
        edge = check_and_redirect_edge(edge, g.drawn_nodes, sdfg_state);
        if (!edge) return;
        const e = new Edge(edge.attributes.data, id, sdfg, sdfg_state.id);
        edge.attributes.data.edge = e;
        e.srcConnector = edge.src_connector || null;
        e.dstConnector = edge.dst_connector || null;
        e.src = parseInt(edge.src);
        e.dst = parseInt(edge.dst);
        g.addEdge(e, id);
    });

    hidden_nodes.forEach(hidden_node => {
        if (hidden_node.src) {
            hidden_node.dsts.forEach(e => {
                // create shortcut edge with new destination
                const tmp_edge = e.attributes.data.edge;
                e.attributes.data.edge = null;
                const shortcut_e = deepCopy(e);
                e.attributes.data.edge = tmp_edge;
                shortcut_e.src = hidden_node.src.src;
                shortcut_e.src_connector = hidden_node.src.src_connector;
                shortcut_e.dst_connector = e.dst_connector;
                // attribute that only shortcut edges have; if it is explicitly false, then edge is ignored in omit access node mode
                shortcut_e.attributes.data.attributes.shortcut = true;

                // draw the redirected edge
                const redirected_e = check_and_redirect_edge(shortcut_e, g.drawn_nodes, sdfg_state);
                if (!redirected_e) return;

                // abort if shortcut edge already exists
                const edges = g.outEdges(redirected_e.src);
                for (const oe of edges) {
                    if (oe.w == e.dst && sdfg_state.edges[oe.name].dst_connector == e.dst_connector) {
                        return;
                    }
                }

                // add shortcut edge (redirection is not done in this list)
                sdfg_state.edges.push(shortcut_e);

                // add redirected shortcut edge to graph
                const edge_id = sdfg_state.edges.length - 1;
                const shortcut_edge = new Edge(deepCopy(redirected_e.attributes.data), edge_id, sdfg, sdfg_state.id);
                shortcut_edge.srcConnector = redirected_e.src_connector || null;
                shortcut_edge.dstConnector = redirected_e.dst_connector || null;
                shortcut_edge.data.attributes.shortcut = true;

                shortcut_edge.src = redirected_e.src;
                shortcut_edge.dst = redirected_e.dst;

                g.addEdge(shortcut_edge, edge_id);
            });
        }
    });

    return g;
}


function calculateNodeSize(sdfg_state, node) {
    let labelsize = getTextMetrics(node.label).width;
    let inconnsize = 2 * LINEHEIGHT * Object.keys(node.attributes.layout.in_connectors).length - LINEHEIGHT;
    let outconnsize = 2 * LINEHEIGHT * Object.keys(node.attributes.layout.out_connectors).length - LINEHEIGHT;
    let maxwidth = Math.max(labelsize, inconnsize, outconnsize);
    let maxheight = 2 * LINEHEIGHT;
    maxheight += 4 * LINEHEIGHT;

    let size = { width: maxwidth, height: maxheight }

    // add something to the size based on the shape of the node
    if (node.type === "AccessNode") {
        size.height -= 4 * LINEHEIGHT;
        size.width += size.height;
    }
    else if (node.type.endsWith("Entry")) {
        size.width += 2.0 * size.height;
        size.height /= 1.75;
    }
    else if (node.type.endsWith("Exit")) {
        size.width += 2.0 * size.height;
        size.height /= 1.75;
    }
    else if (node.type === "Tasklet") {
        size.width += 2.0 * (size.height / 3.0);
        size.height /= 1.75;
    }
    else if (node.type === "LibraryNode") {
        size.width += 2.0 * (size.height / 3.0);
        size.height /= 1.75;
    }
    else if (node.type === "Reduce") {
        size.height -= 4 * LINEHEIGHT;
        size.width *= 2;
        size.height = size.width / 3.0;
    }
    else {
    }

    return size;
}
