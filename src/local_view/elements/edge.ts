// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import type { LViewRenderer } from '../lview_renderer';
import { Element } from './element';
import type { Node } from './node';

export class Edge extends Element {

    constructor(
        public readonly src: Node,
        public readonly dst: Node,
        renderer?: LViewRenderer
    ) {
        super(renderer);
    }

}
