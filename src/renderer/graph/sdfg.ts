import { InvalidSDFGError, JsonSDFG } from '../..';
import { Graph } from './graph';
import { GraphNode } from './graph_element';
import { GraphSerializer } from './graph_serializer';

export class SDFG extends Graph {

    public static readonly TYPE: string = 'SDFG';

    public readonly attributes: Map<string, any> = new Map();

    private sdfgListId: number = 0;
    private startStateId: number = 0;

    private daceVersion?: string;
    private error?: InvalidSDFGError;

    public constructor() {
        super();
    }

    public toJSON(): JsonSDFG {
        return {
            attributes: this.attributes,
            nodes: this.nodes,
            edges: this.edges,
            dace_version: this.daceVersion ? this.daceVersion : '',
            sdfg_list_id: this.sdfgListId,
            start_state: this.startStateId,
            type: SDFG.TYPE,
        };
    }

    public static fromJSON(value: JsonSDFG): SDFG {
        const instance = new SDFG();

        for (const key in value.attributes)
            instance.attributes.set(key, value.attributes[key]);

        instance.sdfgListId = value.sdfg_list_id;
        instance.startStateId = value.start_state;
        instance.daceVersion = value.dace_version;
        instance.error = value.error;

        value.nodes.forEach(node => {
            const candidate = GraphSerializer.fromJSON(node);
            if (candidate && candidate instanceof GraphNode)
                instance.addNode(candidate);
        });

        return instance;
    }

}
