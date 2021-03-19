// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

import { State, NestedSDFG, SDFGNode } from '../../renderer/renderer_elements';


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
export function get_uuid_graph_element(element: State | NestedSDFG | SDFGNode): string {
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
