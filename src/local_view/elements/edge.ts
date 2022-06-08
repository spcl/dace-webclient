import { Element } from './element';
import { Node } from './node';

export class Edge extends Element {

    constructor(
        public readonly src: Node,
        public readonly dst: Node,
    ) {
        super();
    }

}
