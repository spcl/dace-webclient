// Copyright 2019-2020 ETH Zurich and the DaCe authors. All rights reserved.

/**
 * Return the string UUID for an SDFG graph element.
 *
 * UUIDs have the form of "G/S/N/E", where:
 * G = Graph list id
 * S = State ID (-1 for (nested) SDFGs)
 * N = Node ID (-1 for States, SDFGs, and Edges)
 * E = Edge ID (-1 for States, SDFGs, and Nodes)
 *
 * @param {*} element   Element to generate the UUID for.
 *
 * @returns             String containing the UUID
 */
function get_uuid_graph_element(element) {
    let undefined_val = -1;
    if (element instanceof State) {
        return (
            element.sdfg.sdfg_list_id + '/' +
            element.id + '/' +
            undefined_val + '/' +
            undefined_val
        );
    } else if (element instanceof NestedSDFG) {
        let sdfg_id = element.data.node.attributes.sdfg.sdfg_list_id;
        return (
            sdfg_id + '/' +
            undefined_val + '/' +
            undefined_val + '/' +
            undefined_val
        );
    } else if (element instanceof Node) {
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

function recursively_find_graph(graph, graph_id, ns_node=undefined) {
    if (graph.node(0).sdfg.sdfg_list_id === graph_id) {
        return {
            graph: graph,
            node: ns_node,
        };
    } else {
        let result = {
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
                            result = search_graph;
                            return result;
                        }
                    }
                });
            return result;
        });
        return result;
    }
}

function find_graph_element_by_uuid(p_graph, uuid) {
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

function find_exit_for_entry(nodes, entry_node) {
    for(let n of nodes) {
        if(n.type.endsWith("Exit") && parseInt(n.scope_entry) == entry_node.id) {
            return n;
        }
    }
    console.warn("Did not find corresponding exit");
    return null;
}


function check_and_redirect_edge(edge, drawn_nodes, sdfg_state) {
    // If destination is not drawn, no need to draw the edge
    if (!drawn_nodes.has(edge.dst))
        return null;
    // If both source and destination are in the graph, draw edge as-is
    if (drawn_nodes.has(edge.src))
        return edge;

    // If immediate scope parent node is in the graph, redirect
    let scope_src = sdfg_state.nodes[edge.src].scope_entry;
    if (!drawn_nodes.has(scope_src))
        return null;

    // Clone edge for redirection, change source to parent
    let new_edge = Object.assign({}, edge);
    new_edge.src = scope_src;

    return new_edge;
}

function equals(a, b) {
     return JSON.stringify(a) === JSON.stringify(b);
}


function reviver(name, val) {
    if (name == 'sdfg' && val && typeof val === 'string' && val[0] === '{') {
        return JSON.parse(val, reviver);
    }
    return val;
}

// Recursively parse SDFG, including nested SDFG nodes
function parse_sdfg(sdfg_json) {
    return JSON.parse(sdfg_json, reviver);
}

function isDict(v) {
    return typeof v === 'object' && v !== null && !(v instanceof Array) && !(v instanceof Date);
}

function replacer(name, val, orig_sdfg) {
    if (val && isDict(val) && val !== orig_sdfg && 'type' in val && val.type === 'SDFG') {
        return JSON.stringify(val, (n,v) => replacer(n, v, val));
    }
    return val;
}

function stringify_sdfg(sdfg) {
    return JSON.stringify(sdfg, (name, val) => replacer(name, val, sdfg));
}

function sdfg_range_elem_to_string(range, settings=null) {
    let preview = '';
    if (range.start == range.end && range.step == 1 && range.tile == 1)
        preview += sdfg_property_to_string(range.start, settings);
    else {
        if (settings && settings.inclusive_ranges) {
            preview += sdfg_property_to_string(range.start, settings) + '..' +
                sdfg_property_to_string(range.end, settings);
        } else {
            let endp1 = sdfg_property_to_string(range.end, settings) + ' + 1';
            // Try to simplify using math.js
            var mathjs = undefined;
            try {
                mathjs = window.math;
            } catch(e) {
                try { mathjs = math; } catch(e) {}
            }
            try {
                endp1 = mathjs.simplify(endp1).toString();
            } catch(e) {}
            preview += sdfg_property_to_string(range.start, settings) + ':' +
                endp1;
        }
        if (range.step != 1) {
            preview += ':' + sdfg_property_to_string(range.step, settings);
            if (range.tile != 1)
                preview += ':' + sdfg_property_to_string(range.tile, settings);
        } else if (range.tile != 1) {
            preview += '::' + sdfg_property_to_string(range.tile, settings);
        }
    }
    return preview;
}

// Includes various properties and returns their string representation
function sdfg_property_to_string(prop, settings=null) {
    if (prop === null) return prop;
    if (typeof prop === 'boolean') {
        if (prop)
            return 'True';
        return 'False';
    } else if (prop.type === "Indices" || prop.type === "subsets.Indices") {
        let indices = prop.indices;
        let preview = '[';
        for (let index of indices) {
            preview += sdfg_property_to_string(index, settings) + ', ';
        }
        return preview.slice(0, -2) + ']';
    } else if (prop.type === "Range" || prop.type === "subsets.Range") {
        let ranges = prop.ranges;

        // Generate string from range
        let preview = '[';
        for (let range of ranges) {
            preview += sdfg_range_elem_to_string(range, settings) + ', ';
        }
        return preview.slice(0, -2) + ']';
    } else if (prop.language !== undefined) {
        // Code
        if (prop.string_data !== '' && prop.string_data !== undefined && prop.string_data !== null)
            return '<pre class="code"><code>' + prop.string_data.trim() +
                '</code></pre><div class="clearfix"></div>';
        return '';
    } else if (prop.approx !== undefined && prop.main !== undefined) {
        // SymExpr
        return prop.main;
    } else if (prop.constructor == Object) {
        // General dictionary
        return '<pre class="code"><code>' + JSON.stringify(prop, undefined, 4) +
            '</code></pre><div class="clearfix"></div>';
    } else if (prop.constructor == Array) {
        // General array
        let result = '[ ';
        let first = true;
        for (let subprop of prop) {
            if (!first)
                result += ', ';
            result += sdfg_property_to_string(subprop, settings);
            first = false;
        }
        return result + ' ]';
    } else {
        return prop;
    }
}

function deepCopy(obj) {
    if (!(obj instanceof Object) || obj == null) return obj;
    let newObj = Array.isArray(obj) ? [] : {};
    for (let el in obj)
        newObj[el] = deepCopy(obj[el]);
    return newObj;
}

/**
 * Receives a callback that accepts (node, parent graph) and returns a value.
 * This function is invoked recursively per scope (including scope nodes), unless the return
 * value is false, upon which the sub-scope will not be visited.
 * The function also accepts an optional post-subscope callback (same signature as `func`).
 **/
function traverse_sdfg_scopes(sdfg, func, post_subscope_func=null) {
    function scopes_recursive(graph, nodes, processed_nodes=null) {
        if (processed_nodes === null)
            processed_nodes = new Set();

        for (let nodeid of nodes) {
            let node = graph.node(nodeid);
            if (node === undefined || processed_nodes.has(node.id.toString()))
                continue;

            // Invoke function
            let result = func(node, graph);

            // Skip in case of e.g., collapsed nodes
            if (result !== false) {
                // Traverse scopes recursively (if scope_dict provided)
                if (node.type().endsWith('Entry')) {
                    let state = node.sdfg.nodes[node.parent_id];
                    if (state.scope_dict[node.id] !== undefined)
                        scopes_recursive(graph, state.scope_dict[node.id], processed_nodes);
                }

                // Traverse states or nested SDFGs
                if (node.data.graph) {
                    let state = node.data.state;
                    if (state !== undefined && state.scope_dict[-1] !== undefined)
                        scopes_recursive(node.data.graph, state.scope_dict[-1]);
                    else // No scope_dict, traverse all nodes as a flat hierarchy
                        scopes_recursive(node.data.graph, node.data.graph.nodes());
                }
            }
            
            if (post_subscope_func)
                post_subscope_func(node, graph);

            processed_nodes.add(node.id.toString());
        }
    }
    scopes_recursive(sdfg, sdfg.nodes());
}

/**
 * Returns a partial memlet tree from a given edge, from the root node
 * through all children (without siblings). Calling this function with
 * the root edge returns the entire memlet tree.
 **/
function memlet_tree(graph, edge, root_only = false) {
    let result = [];
    let graph_edges = {};
    graph.edges().forEach(e => {
       graph_edges[e.name] = e;
    });


    function src(e) {
        let ge = graph_edges[e.id];
        return graph.node(ge.v);
    }
    function dst(e) {
        let ge = graph_edges[e.id];
        return graph.node(ge.w);
    }

    // Determine direction
    let propagate_forward = false, propagate_backward = false;
    if ((edge.src_connector && src(edge) instanceof EntryNode) ||
        (edge.dst_connector && dst(edge) instanceof EntryNode &&
         edge.dst_connector.startsWith('IN_')))
        propagate_forward = true;
    if ((edge.src_connector && src(edge) instanceof ExitNode) ||
        (edge.dst_connector && dst(edge) instanceof ExitNode))
        propagate_backward = true;

    result.push(edge);

    // If either both are false (no scopes involved) or both are true
    // (invalid SDFG), we return only the current edge as a degenerate tree
    if (propagate_forward == propagate_backward)
        return result;

    // Ascend (find tree root) while prepending
    let curedge = edge;
    if (propagate_forward) {
        let source = src(curedge);
        while(source instanceof EntryNode && curedge && curedge.src_connector) {
            if (source.attributes().is_collapsed)
                break;

            let cname = curedge.src_connector.substring(4);  // Remove OUT_
            curedge = null;
            graph.inEdges(source.id).forEach(e => {
                let ge = graph.edge(e);
                if (ge.dst_connector == 'IN_' + cname)
                    curedge = ge;
            });
            if (curedge) {
                result.unshift(curedge);
                source = src(curedge);
            }
        }
    } else if (propagate_backward) {
        let dest = dst(curedge);
        while(dest instanceof ExitNode && curedge && curedge.dst_connector) {
            let cname = curedge.dst_connector.substring(3);  // Remove IN_
            curedge = null;
            graph.outEdges(dest.id).forEach(e => {
                let ge = graph.edge(e);
                if (ge.src_connector == 'OUT_' + cname)
                    curedge = ge;
            });
            if (curedge) {
                result.unshift(curedge);
                dest = dst(curedge);
            }
        }
    }

    if (root_only)
        return [result[0]];

    // Descend recursively
    function add_children(edge) {
        let children = [];
        if (propagate_forward) {
            let next_node = dst(edge);
            if (!(next_node instanceof EntryNode) ||
                    !edge.dst_connector || !edge.dst_connector.startsWith('IN_'))
                return;
            if (next_node.attributes().is_collapsed)
                return;
            let conn = edge.dst_connector.substring(3);
            graph.outEdges(next_node.id).forEach(e => {
                let ge = graph.edge(e);
                if (ge.src_connector == 'OUT_' + conn) {
                    children.push(ge);
                    result.push(ge);
                }
            });
        } else if (propagate_backward) {
            let next_node = src(edge);
            if (!(next_node instanceof ExitNode) || !edge.src_connector)
                return;
            let conn = edge.src_connector.substring(4);
            graph.inEdges(next_node.id).forEach(e => {
                let ge = graph.edge(e);
                if (ge.dst_connector == 'IN_' + conn) {
                    children.push(ge);
                    result.push(ge);
                }
            });
        }

        for (let child of children)
            add_children(child);
    }

    // Start from current edge
    add_children(edge);

    return result;
}

/**
 * Returns a partial memlet tree from a given edge. It descends into nested SDFGs.
 * @param visited_edges is used to speed up the computation of the memlet trees
 **/
function memlet_tree_nested(sdfg, state, edge, visited_edges = []) {
    if (visited_edges.includes(edge) || edge.attributes.data.attributes.shortcut) {
        return [];
    }

    visited_edges.push(edge);

    let result = [];

    function src(e) {
        return state.nodes[e.src];
    }
    function dst(e) {
        return state.nodes[e.dst];
    }
    function isview(node) {
        if (node.type == "AccessNode") {
            let nodedesc = sdfg.attributes._arrays[node.attributes.data];
            return (nodedesc && nodedesc.type === "View");
        }
        return false;
    }

    // Determine direction
    let propagate_forward = false, propagate_backward = false;
    if ((edge.src_connector && src(edge).type.endsWith("Entry")) ||
        (edge.dst_connector && dst(edge).type.endsWith("Entry") &&
        edge.dst_connector.startsWith('IN_')) ||
        dst(edge).type == "NestedSDFG" ||
        isview(dst(edge)))
        propagate_forward = true;
    if ((edge.src_connector && src(edge).type.endsWith("Exit")) ||
        (edge.dst_connector && dst(edge).type.endsWith("Exit")) ||
        src(edge).type == "NestedSDFG" ||
        isview(src(edge)))
        propagate_backward = true;

    result.push(edge);

    // If either both are false (no scopes involved), we 
    // return only the current edge as a degenerate tree
    if (propagate_forward == propagate_backward && propagate_backward === false)
        return result;

    // Descend recursively
    function add_children(edge) {
        let children = [];

        if (propagate_forward) {
            let next_node = dst(edge);

            // Descend into nested SDFG
            if (next_node.type == "NestedSDFG") {
                let name = edge.dst_connector;
                let nested_sdfg = next_node.attributes.sdfg;

                nested_sdfg.nodes.forEach( nstate => {
                    nstate.edges.forEach( e => {
                        let node = nstate.nodes[e.src];
                        if (node.type == "AccessNode" && node.attributes.data === name) {
                            result = result.concat(memlet_tree_nested(nested_sdfg, nstate, e, visited_edges));
                        }
                    });
                });
            }

            if (isview(next_node)) {
                state.edges.forEach( e => {
                    if (e.src == next_node.id) {
                        children.push(e);
                        if (!e.attributes.data.attributes.shortcut) {
                            result.push(e);
                        }
                    }
                });
            } else {
                if (!(next_node.type.endsWith("Entry")) ||
                    !edge.dst_connector || !edge.dst_connector.startsWith('IN_'))
                    return;
                if (next_node.attributes.is_collapsed)
                    return;
                let conn = edge.dst_connector.substring(3);
                state.edges.forEach( e => {
                    if (e.src == next_node.id && e.src_connector == 'OUT_' + conn) {
                        children.push(e);
                        if (!e.attributes.data.attributes.shortcut) {
                            result.push(e);
                        }
                    }
                });
            }
        } 
        if (propagate_backward) {
            let next_node = src(edge);

            // Descend into nested SDFG
            if (next_node.type == "NestedSDFG") {
                let name = edge.src_connector;
                let nested_sdfg = next_node.attributes.sdfg;

                nested_sdfg.nodes.forEach( nstate => {
                    nstate.edges.forEach( e => {
                        let node = nstate.nodes[e.dst];
                        if (node.type == "AccessNode" && node.attributes.data == name) {
                            result = result.concat(memlet_tree_nested(nested_sdfg, nstate, e, visited_edges));
                        }
                    });
                });
            }

            if (isview(next_node)) {
                state.edges.forEach( e => {
                    if (e.dst == next_node.id) {
                        children.push(e);
                        result.push(e);
                    }
                });
            } else {
                if (!(next_node.type.endsWith("Exit")) || !edge.src_connector)
                    return;

                let conn = edge.src_connector.substring(4);
                state.edges.forEach( e => {
                    if (e.dst == next_node.id && e.dst_connector == 'IN_' + conn) {
                        children.push(e);
                        result.push(e);
                    }
                });
            }
        }

        for (let child of children)
            add_children(child);
    }

    // Start from current edge
    add_children(edge);

    return result;
}

/**
 * Calls memlet_tree_nested for every nested SDFG and its edges and returns a list with all memlet trees.
 * As edges are visited only in one direction (from outer SDFGs to inner SDFGs) a memlet can be split into several
 * arrays.
 */
function memlet_tree_recursive(root_sdfg) {
    let trees = [];
    let visited_edges = [];

    root_sdfg.nodes.forEach( state => {

        state.edges.forEach( e => {
            let tree = memlet_tree_nested(root_sdfg, state, e, visited_edges);
            if (tree.length > 1) {
                trees.push(tree);
            }
        });
    
        state.nodes.forEach( n => {
            if (n.type == "NestedSDFG") {
                let t = memlet_tree_recursive(n.attributes.sdfg);
                trees = trees.concat(t);
            }
        });
    
    })

    return trees;
}

/**
 * Returns all memlet trees as sets for the given graph.
 * 
 * @param {Graph} root_graph The top level graph.
 */
function memlet_tree_complete(sdfg) {
    let all_memlet_trees = [];
    let memlet_trees = memlet_tree_recursive(sdfg);

    // combine trees as memlet_tree_recursive does not necessarily return the complete trees (they might be split into several trees)
    memlet_trees.forEach( tree => {
        let common_edge = false;
        for (const mt of all_memlet_trees) {
            for (const edge of tree) {
                if (mt.has(edge)) {
                    tree.forEach(e => mt.add(e));
                    common_edge = true;
                    break;
                }
            }
            if (common_edge)
                break;
        }
        if (!common_edge)
            all_memlet_trees.push(new Set(tree));
    });

    return all_memlet_trees;
}
