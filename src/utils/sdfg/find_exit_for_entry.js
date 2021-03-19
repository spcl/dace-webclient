// Copyright 2019-2020 ETH Zurich and the DaCe authors. All rights reserved.

export function find_exit_for_entry(nodes, entry_node) {
    for (const n of nodes) {
        if (n.type.endsWith("Exit") && parseInt(n.scope_entry) == entry_node.id) {
            return n;
        }
    }
    console.warn("Did not find corresponding exit");
    return null;
}
