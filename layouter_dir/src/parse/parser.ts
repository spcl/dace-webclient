import * as _ from "lodash";
import AccessNode from "../renderGraph/accessNode";
import InterstateEdge from "../renderGraph/interstateEdge";
import LibraryNode from "../renderGraph/libraryNode";
import MapEntry from "../renderGraph/mapEntry";
import MapExit from "../renderGraph/mapExit";
import Memlet from "../renderGraph/memlet";
import NestedSdfg from "../renderGraph/nestedSdfg";
import RenderGraph from "../renderGraph/renderGraph"
import SdfgState from "../renderGraph/sdfgState";
import Tasklet from "../renderGraph/tasklet";
import RenderNode from "../renderGraph/renderNode";

export default class Parser {
    static parse(json): RenderGraph {
        const graph = new RenderGraph();
        _.forEach(json.nodes, (jsonNode) => {
            this.addNode(graph, jsonNode);
        });
        _.forEach(json.edges, (jsonEdge) => {
            const edge = new (this.classForType(jsonEdge.attributes.data.type))(parseInt(jsonEdge.src), parseInt(jsonEdge.dst), jsonEdge.src_connector, jsonEdge.dst_connector, jsonEdge.attributes.data.attributes);
            graph.addEdge(edge);
        });
        return graph;
    }

    static addNode(graph: RenderGraph, jsonNode): void {
        const node = new (this.classForType(jsonNode.type))(jsonNode.type, jsonNode.label);

        // set child graph
        if (jsonNode.type === "NestedSDFG") {
            node.setChildGraph(this.parse(jsonNode.attributes.sdfg));
        }
        if (jsonNode.type === "SDFGState") {
            node.setChildGraph(this.parse(jsonNode));
        }

        // set connectors
        let inConnectors = [];
        if (jsonNode.attributes.in_connectors) {
            if (Array.isArray(jsonNode.attributes.in_connectors)) {
                inConnectors = jsonNode.attributes.in_connectors;
            } else {
                inConnectors = Object.keys(jsonNode.attributes.in_connectors);
            }
        }
        let outConnectors = [];
        if (jsonNode.attributes.out_connectors) {
            if (Array.isArray(jsonNode.attributes.out_connectors)) {
                outConnectors = jsonNode.attributes.out_connectors;
            } else {
                outConnectors = Object.keys(jsonNode.attributes.out_connectors);
            }
        }

        node.setConnectors(inConnectors, outConnectors);

        // set scope entry and exit
        node.scopeEntry = jsonNode.scope_entry ? parseInt(jsonNode.scope_entry) : null;
        node.scopeExit = jsonNode.scope_exit ? parseInt(jsonNode.scope_exit) : null;

        graph.addNode(node, jsonNode.id);
    }

    static classForType(type: string): any {
        const types = {
            "AccessNode": AccessNode,
            "LibraryNode": LibraryNode,
            "MapEntry": MapEntry,
            "MapExit": MapExit,
            "NestedSDFG": NestedSdfg,
            "SDFGState": SdfgState,
            "Tasklet": Tasklet,
            "Memlet": Memlet,
            "InterstateEdge": InterstateEdge,
        }
        if (!types.hasOwnProperty(type)) {
            throw new Error("Unknown node or edge type: " + type);
        }
        return types[type];
    }
}
