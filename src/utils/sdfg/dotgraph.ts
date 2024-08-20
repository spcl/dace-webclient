// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import { JsonSDFGControlFlowRegion, JsonSDFGEdge } from '../..';

function cfgEdgeToDotGraphEdge(edge: JsonSDFGEdge): string {
    return edge.src.toString() + ' -> ' + edge.dst.toString();
}

export function cfgToDotGraph(cfg: JsonSDFGControlFlowRegion): string {
    let graphString = '';

    graphString += 'digraph "' + (cfg.attributes?.name ?? 'program') + '" {\n';

    for (const edge of cfg.edges)
        graphString += '  ' + cfgEdgeToDotGraphEdge(edge) + '\n';

    graphString += '}\n';

    return graphString;
}
