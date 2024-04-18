// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import {
    DagreGraph
} from '../../index';

/**
 * Receives a callback that accepts (node, parent graph) and returns a value.
 * This function is invoked recursively per scope (including scope nodes),
 * unless the return value is false, upon which the sub-scope will not be
 * visited. The function also accepts an optional post-subscope callback (same
 * signature as `func`).
 **/
 export function traverseSDFGScopes(
    sdfg: DagreGraph, func: CallableFunction, postSubscopeFunc?: CallableFunction
): void {
    function scopesRecursive(
        graph: DagreGraph, nodes: string[], processedNodes?: Set<string>
    ): void {
        if (processedNodes === undefined)
            processedNodes = new Set();

        for (const nodeid of nodes) {
            const node = graph.node(nodeid);

            if (node === undefined || processedNodes.has(node.id.toString()))
                continue;

            // Invoke function.
            const result = func(node, graph);

            // Skip in case of e.g., collapsed nodes.
            if (result !== false) {
                // Traverse scopes recursively (if scope_dict provided).
                if (node.type().endsWith('Entry') && node.parent_id !== null &&
                    node.id !== null) {
                    const state = node.parentElem?.data.state;
                    if (state.scope_dict[node.id] !== undefined)
                        scopesRecursive(
                            graph, state.scope_dict[node.id], processedNodes
                        );
                }

                // Traverse states or nested SDFGs
                if (node.data.graph) {
                    const state = node.data.state;
                    if (state !== undefined &&
                        state.scope_dict[-1] !== undefined)
                        scopesRecursive(node.data.graph, state.scope_dict[-1]);
                    else // No scope_dict, traverse all nodes as a flat hierarchy
                        scopesRecursive(
                            node.data.graph, node.data.graph.nodes()
                        );
                }
            }

            if (postSubscopeFunc)
                postSubscopeFunc(node, graph);

            processedNodes.add(node.id?.toString());
        }
    }

    scopesRecursive(sdfg, sdfg.nodes());
}
