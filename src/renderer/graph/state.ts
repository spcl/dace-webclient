import { Text } from 'pixi.js';
import { JsonSDFGEdge, JsonSDFGNode, JsonSDFGState } from '../..';
import { Graph } from './graph';
import { GraphEdge, GraphNode, ScopedNode, ScopeExitNode } from './graph_element';
import { GraphSerializer } from './graph_serializer';

export class State extends GraphNode {

    public static readonly TYPE: string = 'SDFGState';

    public readonly stateGraph: Graph = new Graph();
    public readonly scopeDict: Map<string, number[]> = new Map();

    private readonly labelGfx: Text = new Text('');

    public constructor(id: number) {
        super(id);
        this.addChild(this.stateGraph);
        this.stateGraph.position.set(0);
    }

    public type(): string {
        return State.TYPE;
    }

    public draw(): void {
        super.draw();

        this.drawSelf();

        this.stateGraph.draw();
    }

    private drawSelf(): void {
        if (this.layoutNode) {
            const pos = {
                x: this.layoutNode.x,
                y: this.layoutNode.y,
            };
            const lPos = this.parent.toLocal(pos);
            this.position.set(lPos.x, lPos.y);

            this.lineStyle({
                width: 1,
                color: 0x000000,
            });
            this.beginFill(0x4287f5, 0.3);
            this.drawRect(
                0, 0, this.layoutNode.width, this.layoutNode.height
            );
        } else {
            this.lineStyle({
                width: 1,
                color: 0x000000,
            });

            this.beginFill(0x4287f5, 0.3);
            this.drawRect(
                0, 0, this.stateGraph.width, this.stateGraph.height
            );
            this.endFill();
        }
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

                                    candidate.draw(false);
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

            instance.drawSelf();

            return instance;
        }

        return undefined;
    }

    public get childGraph(): Graph {
        return this.stateGraph;
    }

}
