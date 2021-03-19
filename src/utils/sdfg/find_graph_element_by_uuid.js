// Copyright 2019-2020 ETH Zurich and the DaCe authors. All rights reserved.

import { recursively_find_graph } from "./recursively_find_graph";

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
