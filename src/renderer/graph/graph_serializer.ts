import { AccessNode } from './access_node';
import { GraphElement, ScopeExitNode } from './graph_element';
import { MapNode } from './map_node';
import { Memlet } from './memlet';
import { State } from './state';
import { Tasklet } from './tasklet';

export abstract class GraphSerializer {

    private constructor() {
        return;
    }

    public static fromJSON(value: any): GraphElement | undefined {
        switch (value.type) {
            case AccessNode.TYPE:
                return AccessNode.fromJSON(value);
            case State.TYPE:
                return State.fromJSON(value);
            case Tasklet.TYPE:
                return Tasklet.fromJSON(value);
            case MapNode.TYPE:
                return MapNode.fromJSON(value);
            case MapNode.EXIT_TYPE:
                return ScopeExitNode.fromJSON(value);
            case Memlet.TYPE:
                return Memlet.fromJSON(value);
        }
        return undefined;
    }

}
