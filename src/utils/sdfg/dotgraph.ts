// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import { JsonSDFGControlFlowRegion, JsonSDFGEdge } from '../..';

function cfgEdgeToDotGraphEdge(
    cfg: JsonSDFGControlFlowRegion, edge: JsonSDFGEdge
): string {
    const srcName = cfg.nodes[Number(edge.src)].label;
    const dstName = cfg.nodes[Number(edge.dst)].label;
    return srcName + ' -> ' + dstName;
}

export function cfgToDotGraph(cfg: JsonSDFGControlFlowRegion): string {
    let graphString = '';

    graphString += 'digraph "' + (cfg.attributes?.name ?? 'program') + '" {\n';

    for (const edge of cfg.edges)
        graphString += '  ' + cfgEdgeToDotGraphEdge(cfg, edge) + '\n';

    graphString += '}\n';

    return graphString;
}
