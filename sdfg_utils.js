// Copyright 2019-2020 ETH Zurich and the DaCe authors. All rights reserved.

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
        if (prop.string_data !== '' && prop.string_data !== undefined)
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
            if (node !== undefined && processed_nodes.has(node.id.toString()))
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

// contains already visited edges to speed up computation of memlet trees
var memlet_tree_edges_visited = [];

/**
 * Returns a partial memlet tree from a given edge, from the given node 
 * through all children (without siblings). Calling this function with
 * the root edge returns the entire memlet tree.
 **/
function memlet_tree(graph, edge) {
    if (memlet_tree_edges_visited.includes(edge)) {
        return [];
    }

    memlet_tree_edges_visited.push(edge);

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
         edge.dst_connector.startsWith('IN_')) ||
         dst(edge) instanceof NestedSDFG)
        propagate_forward = true;
    if ((edge.src_connector && src(edge) instanceof ExitNode) || 
        (edge.dst_connector && dst(edge) instanceof ExitNode) ||
         src(edge) instanceof NestedSDFG)
        propagate_backward = true;

    result.push(edge);

    // If either both are false (no scopes involved) or both are true
    // (invalid SDFG), we return only the current edge as a degenerate tree
    if (propagate_forward == propagate_backward)
        return result;

    // Descend recursively
    function add_children(edge) {
        let children = [];
        if (propagate_forward) {
            let next_node = dst(edge);

            // Descend into nested SDFG
            if (next_node instanceof NestedSDFG) {
                let nested_graph = next_node.data.graph;
                let name = edge.dst_connector;
                
                nested_graph.nodes().forEach( state_id => {
                    let state = nested_graph.node(state_id);
                    if (!state) return;

                    let s_graph = state.data.graph;
                    if (!s_graph) return;

                    s_graph.edges().forEach( e => {
                        let node = s_graph.node(e.v); // source
                        if (node instanceof AccessNode && node.data.node.attributes.data == name) {
                            result = result.concat(memlet_tree(s_graph, s_graph.edge(e)));
                        }
                    });
                });
            }

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
            
            // Descend into nested SDFG
            if (next_node instanceof NestedSDFG) {
                let nested_graph = next_node.data.graph;
                let name = edge.src_connector;
                
                nested_graph.nodes().forEach( state_id => {
                    let state = nested_graph.node(state_id);
                    if (!state) return;
                    
                    let s_graph = state.data.graph;
                    if (!s_graph) return;
                    
                    s_graph.edges().forEach( e => {
                        let node = s_graph.node(e.w); // destination
                        if (node instanceof AccessNode && node.data.node.attributes.data == name) {
                            result = result.concat(memlet_tree(s_graph, s_graph.edge(e)));
                        }
                    });
                });
            }

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
 * Calls memlet_tree for every nested sdfg and its edges and returns a list with all memlet trees.
 */
function memlet_tree_recursive(root_graph) {
    let trees = [];

    root_graph.nodes().forEach( state_id => {
        let state = root_graph.node(state_id);
        if (state == null) return;

        let graph = state.data.graph;
        if (graph == null) return trees;
    
        graph.edges().forEach( e => {
            let tree = memlet_tree(graph, graph.edge(e));
            if (tree.length > 1) {
                trees.push(tree);
            }
        });
    
        graph.nodes().forEach( n => {
            let node = graph.node(n);
            if (node instanceof NestedSDFG) {
                if (graph != null) {
                    let t = memlet_tree_recursive(node.data.graph);
                    trees = trees.concat(t);
                }
            }
        });
    
    })

    return trees;
}

// Contains all the memlet trees after memlet_tree_complete has been called. They don't need to be recomputed.
var all_memlet_trees = null;

/**
 * Returns the memlet tree for the given edge.
 * 
 * @param {Graph} root_graph The top level graph.
 * @param {Edge} edge The edge that must be contained in the memlet tree.
 * @param {boolean} recompute_trees If set to true, then the memlets trees are recomputed. (Needed when the graph has changed...)
 */
function memlet_tree_complete(root_graph, edge, recompute_trees = false) {
    if (all_memlet_trees == null || recompute_trees) {
        memlet_tree_edges_visited = [];
        all_memlet_trees = [];

        let memlet_trees = memlet_tree_recursive(root_graph);

        // combine trees as memlet_tree_recursive does not necessarily return the complete trees (they might be splitted into several trees)
        memlet_trees.forEach( tree => {
            common_edge = false;
            for (mt of all_memlet_trees) {
                for (edge of tree) {
                    if (mt.has(edge)) {
                        mt.add(...tree);
                        common_edge = true;
                        break;
                    }
                }
                if (common_edge)
                    break;
            }
            if (!common_edge)
                all_memlet_trees.push(new Set(tree));
        })

    }

    for (tree of all_memlet_trees) {
        if (tree.has(edge)) {
            return tree;
        }
    }

    return [];
}