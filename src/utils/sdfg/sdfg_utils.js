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

/**
 * Initializes positioning information on the given element.
 *
 * @param {SDFGElement} elem    The element that gets new positioning information
 * @returns                     The initial positioning information that has been created
 */
export function initialize_positioning_info(elem) {
    let position;
    if (elem instanceof Edge || elem.type === "MultiConnectorEdge") {
        let points = undefined;
        if (elem.points)
            points = Array(elem.points.length);

        position = {
            points: points,
            scope_dx: 0,
            scope_dy: 0
        };

        for (let i = 0; elem.points && i < elem.points.length; i++)
            position.points[i] = { dx: 0, dy: 0 };
    } else {
        position = { dx: 0, dy: 0, scope_dx: 0, scope_dy: 0 };
    }

    set_positioning_info(elem, position);

    return position;
}

/**
 * Sets the positioning information on a given element. Replaces old
 * positioning information.
 * 
 * @param {SDFGElement} elem    The element that receives new positioning info
 * @param {*} position          The positioning information
 */
export function set_positioning_info(elem, position) {
    if (elem instanceof State)
        elem.data.state.attributes.position = position;
    else if (elem instanceof SDFGNode)
        elem.data.node.attributes.position = position;
    else if (elem instanceof Edge)
        elem.data.attributes.position = position;
    else if (elem.type === "MultiConnectorEdge")
        elem.attributes.data.attributes.position = position;
    // Works also for other objects with attributes
    else if (elem.attributes)
        elem.attributes.position = position;
}

/**
 * Finds the positioning information of the given element
 *
 * @param {SDFGElement} elem    The element that contains the information
 * @returns                     The positioning information if available, undefined otherwise
 */
export function get_positioning_info(elem) {
    if (elem instanceof State)
        return elem.data.state.attributes.position;
    if (elem instanceof SDFGNode)
        return elem.data.node.attributes.position;
    if (elem instanceof Edge)
        return elem.data.attributes.position;
    if (elem?.type === "MultiConnectorEdge")
        return elem?.attributes?.data?.attributes?.position;
    // Works also for other objects with attributes
    if (elem?.attributes)
        return elem.attributes.position;

    return undefined;
}

/**
 * Deletes the positioning information of the given element
 *
 * @param {SDFGElement} elem    The element that contains the information
 */
export function delete_positioning_info(elem) {
    if (elem instanceof State)
        delete elem.data.state.attributes.position;
    if (elem instanceof SDFGNode)
        delete elem.data.node.attributes.position;
    if (elem instanceof Edge)
        delete elem.data.attributes.position;
    if (elem?.type === "MultiConnectorEdge")
        delete elem.attributes.data.attributes.position;
    // Works also for other objects with attributes
    if (elem?.attributes)
        delete elem.attributes.position;
}

/**
 * Creates a new SDFGElement of the given type and adds it to the state.
 * Returns the new SDFG element on success, otherwise null.
 *
 * @param sdfg      the sdfg that contains the parent state
 * @param elem_type the type of the new element
 * @param state     the parent state
 * @returns         the new element or null when creation failed
 */
export function add_elem_to_sdfg(sdfg, elem_type, state) {
    let new_elem = {};
    let attributes = {};
    attributes.in_construction = true;
    new_elem.attributes = attributes;

    switch (elem_type) {
        case "MapEntry":
            return null;
        case "ConsumeEntry":
            return null;
        case "Tasklet":
            return null;
        case "NestedSDFG":
            return null;
        case "AccessNode":
            attributes.access = "ReadWrite";
            attributes.data = "";
            attributes.debuginfo = null;
            attributes.in_connectors = {};
            attributes.out_connectors = {};
            attributes.setzero = false;

            new_elem.id = state.data.state.nodes.length;
            new_elem.label = "";
            new_elem.scope_entry = null;
            new_elem.scope_exit = null;
            new_elem.type = elem_type;
            break;
        case "Stream":
            return null;
        case "SDFGState":
            return null;
        default:
            return null;
    }

    if (elem_type !== "SDFGState") {
        state.data.state.scope_dict['-1'].push(new_elem.id);
        state.data.state.nodes.push(new_elem);
    }

    return new_elem;
}
