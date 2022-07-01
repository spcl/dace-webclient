// Copyright 2019-2022 ETH Zurich and the DaCe authors. All rights reserved.

import { LViewRenderer } from '../lview_renderer';
import { Element } from './element';
import { Node } from './node';

export class Edge extends Element {

    constructor(
        public readonly src: Node,
        public readonly dst: Node,
        renderer?: LViewRenderer
    ) {
        super(renderer);
    }

}
