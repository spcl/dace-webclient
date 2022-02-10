import { Text } from 'pixi.js';
import { JsonSDFGEdge, JsonSDFGNode, JsonSDFGState } from '../..';
import { Graph } from './graph';
import { GraphEdge, GraphNode, ScopedNode, ScopeExitNode } from './graph_element';
import { GraphSerializer } from './graph_serializer';

export class State extends GraphNode {

    public static readonly TYPE: string = 'SDFGState';

    public readonly stateGraph: Graph = new Graph();
    public readonly scopeDict: Map<string, number[]> = new Map();

    private labelGfx?: Text;

    public constructor(id: number) {
        super(id);
        this.addChild(this.stateGraph);
    }

    public draw(): void {
        super.draw();

        this.lineStyle({
            width: 1,
            color: 0x000000,
        });
        this.beginFill(0x4287f5, 0.3);
        this.drawRect(0, 0, this.width, this.height);
        this.endFill();

        this.stateGraph.draw();
    }

    private static scopeFromJSON(
        scopes: Map<string, number[]>, nodes: JsonSDFGNode[],
        edges: JsonSDFGEdge[], scopeId: string, targetGraph: Graph,
        scopedNode?: ScopedNode
    ): void {
        if (scopes.has(scopeId)) {
            const scopeNodeIds = scopes.get(scopeId);
            const scopeExitNodeIds: number[] = [];
            if (scopeNodeIds) {
                nodes.forEach(node => {
                    if (scopeNodeIds.includes(node.id)) {
                        const candidate = GraphSerializer.fromJSON(node);
                        if (candidate) {
                            if (candidate instanceof ScopeExitNode &&
                                scopedNode !== undefined) {
                                scopedNode.exit = candidate;
                            } else {
                                targetGraph.addNode(candidate as GraphNode);
                                if (candidate instanceof ScopedNode) {
                                    State.scopeFromJSON(
                                        scopes, nodes, edges,
                                        candidate.id.toString(),
                                        candidate.scopedGraph, candidate
                                    );
                                    if (candidate.exitId !== undefined)
                                        scopeExitNodeIds.push(candidate.exitId);
                                }
                            }
                        }
                    }
                });
            }

            const edgeEndpointIds = scopeNodeIds?.concat(scopeExitNodeIds);
            if (edgeEndpointIds) {
                if (scopedNode !== undefined) {
                    edgeEndpointIds.push(scopedNode.id);
                    if (scopedNode.exitId !== undefined)
                        edgeEndpointIds.push(scopedNode.exitId);
                }

                edges.forEach(edge => {
                    if (edgeEndpointIds.includes(Number(edge.src)) &&
                        edgeEndpointIds.includes(Number(edge.dst))) {
                        const candidate = GraphSerializer.fromJSON(edge);
                        if (candidate && candidate instanceof GraphEdge)
                            targetGraph.addEdge(candidate);
                    }
                });
            }
        }
    }

    public static fromJSON(value: JsonSDFGState): State | undefined {
        if (value.type === State.TYPE && value.id !== undefined) {
            const instance = new this(value.id);

            instance.loadAttributes(value);

            if (value.scope_dict) {
                for (const key in value.scope_dict)
                    instance.scopeDict.set(key, value.scope_dict[key]);
            }

            State.scopeFromJSON(
                instance.scopeDict, value.nodes, value.edges, '-1',
                instance.stateGraph
            );

            return instance;
        }

        return undefined;
    }

}
