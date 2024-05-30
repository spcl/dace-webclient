// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import { Graph } from '../graph/graph';
import { LViewRenderer } from '../lview_renderer';
import { Edge } from './edge';
import { Element } from './element';

export class Node extends Element {

    public readonly inEdges: Edge[] = [];
    public readonly outEdges: Edge[] = [];

    constructor(
        public readonly parentGraph: Graph,
        public readonly id: string,
        renderer?: LViewRenderer
    ) {
        super(renderer);
    }

    public draw(): void {
        super.draw();
    }

}
