// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

/**
 * Receives a callback that accepts (node, parent graph) and returns a value.
 * This function is invoked recursively per scope (including scope nodes), unless the return
 * value is false, upon which the sub-scope will not be visited.
 * The function also accepts an optional post-subscope callback (same signature as `func`).
 **/
export function traverse_sdfg_scopes(sdfg, func, post_subscope_func = null) {
    function scopes_recursive(graph, nodes, processed_nodes = null) {
        if (processed_nodes === null)
            processed_nodes = new Set();

        for (const nodeid of nodes) {
            const node = graph.node(nodeid);
            if (node === undefined || processed_nodes.has(node.id.toString()))
                continue;

            // Invoke function
            const result = func(node, graph);

            // Skip in case of e.g., collapsed nodes
            if (result !== false) {
                // Traverse scopes recursively (if scope_dict provided)
                if (node.type().endsWith('Entry')) {
                    const state = node.sdfg.nodes[node.parent_id];
                    if (state.scope_dict[node.id] !== undefined)
                        scopes_recursive(graph, state.scope_dict[node.id], processed_nodes);
                }

                // Traverse states or nested SDFGs
                if (node.data.graph) {
                    const state = node.data.state;
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
