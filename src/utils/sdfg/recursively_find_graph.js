// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

const { NestedSDFG } = globalThis;

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
