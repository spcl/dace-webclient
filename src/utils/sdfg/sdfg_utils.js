// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

import { SDFGElements } from "../../renderer/renderer_elements";

const { NestedSDFG } = SDFGElements;

export function recursively_find_graph(graph, graph_id, ns_node = undefined) {
    if (graph.node(0).sdfg.sdfg_list_id === graph_id) {
        return {
            graph: graph,
            node: ns_node,
        };
    } else {
        const result = {
            graph: undefined,
            node: undefined,
        };
        graph.nodes().forEach((state_id) => {
            const state = graph.node(state_id);
            if (state.data.graph !== undefined && state.data.graph !== null)
                state.data.graph.nodes().forEach((node_id) => {
                    const node = state.data.graph.node(node_id);
                    if (node instanceof NestedSDFG) {
                        const search_graph = recursively_find_graph(
                            node.data.graph, graph_id, node
                        );
                        if (search_graph.graph !== undefined) {
                            return search_graph;
                        }
                    }
                });
            return result;
        });
        return result;
    }
}


export function find_exit_for_entry(nodes, entry_node) {
    for (const n of nodes) {
        if (n.type.endsWith("Exit") && parseInt(n.scope_entry) == entry_node.id) {
            return n;
        }
    }
    console.warn("Did not find corresponding exit");
    return null;
}


/**
 * Return the string UUID for an SDFG graph element.
 *
 * UUIDs have the form of "G/S/N/E", where:
 * G = Graph list id
 * S = State ID (-1 for (nested) SDFGs)
 * N = SDFGNode ID (-1 for States, SDFGs, and Edges)
 * E = Edge ID (-1 for States, SDFGs, and Nodes)
 *
 * @param {*} element   Element to generate the UUID for.
 *
 * @returns             String containing the UUID
 */
 export function get_uuid_graph_element(element) {
    const undefined_val = -1;
    if (element instanceof State) {
        return (
            element.sdfg.sdfg_list_id + '/' +
            element.id + '/' +
            undefined_val + '/' +
            undefined_val
        );
    } else if (element instanceof NestedSDFG) {
        const sdfg_id = element.data.node.attributes.sdfg.sdfg_list_id;
        return (
            sdfg_id + '/' +
            undefined_val + '/' +
            undefined_val + '/' +
            undefined_val
        );
    } else if (element instanceof SDFGNode) {
        return (
            element.sdfg.sdfg_list_id + '/' +
            element.parent_id + '/' +
            element.id + '/' +
            undefined_val
        );
    }
    return (
        undefined_val + '/' +
        undefined_val + '/' +
        undefined_val + '/' +
        undefined_val
    );
}


export function check_and_redirect_edge(edge, drawn_nodes, sdfg_state) {
    // If destination is not drawn, no need to draw the edge
    if (!drawn_nodes.has(edge.dst))
        return null;
    // If both source and destination are in the graph, draw edge as-is
    if (drawn_nodes.has(edge.src))
        return edge;

    // If immediate scope parent node is in the graph, redirect
    const scope_src = sdfg_state.nodes[edge.src].scope_entry;
    if (!drawn_nodes.has(scope_src))
        return null;

    // Clone edge for redirection, change source to parent
    const new_edge = Object.assign({}, edge);
    new_edge.src = scope_src;

    return new_edge;
}

export function find_graph_element_by_uuid(p_graph, uuid) {
    const uuid_split = uuid.split('/');
    
    const graph_id = Number(uuid_split[0]);
    const state_id = Number(uuid_split[1]);
    const node_id = Number(uuid_split[2]);
    const edge_id = Number(uuid_split[3]);
    
    let result = {
        parent: undefined,
        element: undefined,
    };
    
    let graph = p_graph;
    if (graph_id > 0) {
        const found_graph = recursively_find_graph(graph, graph_id);
        if (found_graph.graph === undefined) {
            throw new Error();
        }
        graph = found_graph.graph;
        result = {
            parent: graph,
            element: found_graph.node,
        };
    }
    
    let state = undefined;
    if (state_id !== -1 && graph !== undefined) {
        state = graph.node(state_id);
        result = {
            parent: graph,
            element: state,
        };
    }
    
    if (node_id !== -1 && state !== undefined && state.data.graph !== null) {
        // Look for a node in a state.
        result = {
            parent: state.data.graph,
            element: state.data.graph.node(node_id),
        };
    } else if (edge_id !== -1 && state !== undefined && state.data.graph !== null) {
        // Look for an edge in a state.
        result = {
            parent: state.data.graph,
            element: state.data.graph.edge(edge_id),
        };
    } else if (edge_id !== -1 && state === undefined) {
        // Look for an inter-state edge.
        result = {
            parent: graph,
            element: graph.edge(edge_id),
        };
    }
    
    return result;
}
