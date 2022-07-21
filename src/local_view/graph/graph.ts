// Copyright 2019-2022 ETH Zurich and the DaCe authors. All rights reserved.

import { DisplayObject, Graphics } from 'pixi.js';
import { StorageType } from '../../overlays/memory_location_overlay';
import { ComputationNode } from '../elements/computation_node';
import {
    AccessMap,
    AccessMode,
    ConcreteDataAccess,
    DataContainer,
    SymbolicDataAccess
} from '../elements/data_container';
import { Edge } from '../elements/edge';
import { Element } from '../elements/element';
import { MapNode } from '../elements/map_node';
import { MemoryMovementEdge } from '../elements/memory_movement_edge';
import { MemoryNode } from '../elements/memory_node';
import { Node } from '../elements/node';
import { LViewRenderer } from '../lview_renderer';

type MemoryNodeMap = Map<DataContainer, Set<[AccessMode, MemoryNode]>>;

export class Graph extends Graphics {

    public readonly memoryNodesMap: MemoryNodeMap = new Map();
    public readonly dataContainers: Map<string, DataContainer> = new Map();

    public readonly nodes: Set<Node> = new Set<Node>();
    public readonly edges: Set<Edge> = new Set<Edge>();

    public constructor(public readonly renderer?: LViewRenderer) {
        super();
    }

    public draw(): void {
        this.clear();
        this.children.forEach(child => {
            if (child instanceof Element)
                child.draw();
        });
    }

    private isNodeContractible(node: Node): boolean {
        return (
            node instanceof MemoryNode &&
            node.dataContainer.storage === StorageType.Register
        ) || (
            node instanceof ComputationNode
        );
    }

    private findContractionRegions(): Set<Set<Node>> {
        const contractionDir = new Map<Node, Set<Node>>();
        for (const node of this.nodes) {
            let contraction = contractionDir.get(node);
            if (contraction === undefined) {
                contraction = new Set<Node>([node]);
                contractionDir.set(node, contraction);
            }

            if (this.isNodeContractible(node)) {
                for (const neighbor of this.neighborhood(node)) {
                    if (this.isNodeContractible(neighbor)) {
                        let neighborContraction = contractionDir.get(neighbor);
                        if (neighborContraction === undefined)
                            neighborContraction = new Set<Node>([neighbor]);
                        const newContraction = new Set([
                            ...contraction,
                            ...neighborContraction,
                        ]);

                        for (const cn of newContraction)
                            contractionDir.set(cn, newContraction);
                    }
                }
            }
        }

        const contractionRegions = new Set<Set<Node>>();
        for (const contractibleSet of contractionDir.values()) {
            if (contractibleSet.size)
                contractionRegions.add(contractibleSet);
        }
        return contractionRegions;
    }

    public contractGraph(): void {
        const contractionRegions = this.findContractionRegions();
        for (const region of contractionRegions) {
            const regionId = region.values().next().value.id;
            const regionInEdges = new Set<Edge>();
            const regionOutEdges = new Set<Edge>();
            const removedContainers = new Set<DataContainer>();
            let contractedText = undefined;
            const newAccessOrder: SymbolicDataAccess[] = [];
            for (const node of region) {
                if (node instanceof ComputationNode) {
                    newAccessOrder.push(...node.accessOrder);
                    if (!contractedText)
                        contractedText = node.text;
                    else
                        contractedText += '\n' + node.text;
                } else if (node instanceof MemoryNode) {
                    removedContainers.add(node.dataContainer);
                }
                this.removeChild(node);

                for (const nEdge of this.neighborEdges(node)) {
                    if (!region.has(nEdge.src))
                        regionInEdges.add(nEdge);
                    if (!region.has(nEdge.dst))
                        regionOutEdges.add(nEdge);
                    this.removeChild(nEdge);
                }
            }

            const cleanedAccessOrder: SymbolicDataAccess[] = [];
            for (const access of newAccessOrder) {
                if (!removedContainers.has(access.dataContainer))
                    cleanedAccessOrder.push(access);
            }

            const contracted = new ComputationNode(
                regionId, this, contractedText ? contractedText : 'Contracted',
                cleanedAccessOrder, 'Contracted', this.nodes.size > 0
            );
            this.addChild(contracted);
            for (const e of regionInEdges) {
                if (e instanceof MemoryMovementEdge) {
                    this.addChild(new MemoryMovementEdge(
                        e.text, this, [], e.src, contracted
                    ));
                    this.removeChild(e);
                }
            }
            for (const e of regionOutEdges) {
                if (e instanceof MemoryMovementEdge) {
                    this.addChild(new MemoryMovementEdge(
                        e.text, this, [], contracted, e.dst
                    ));
                    this.removeChild(e);
                }
            }
        }
    }

    public getAccessesFor(
        scope: Map<string, number>, updateParameters: boolean = false
    ): [
        AccessMap<(number | undefined)[]>, ConcreteDataAccess[]
    ] {
        const idxMap = new AccessMap<(number | undefined)[]>();
        const resolvedAccessOrder: ConcreteDataAccess[] = [];

        for (const child of this.children) {
            if (child instanceof MapNode || child instanceof ComputationNode) {
                const [compIdxMap, compAccessOrder] = child.getAccessesFor(
                    scope, updateParameters
                );
                compIdxMap.forEach(
                    (val, key) => {
                        const prev = idxMap.get(key);
                        if (prev !== undefined)
                            idxMap.set(key, prev.concat(val));
                        else
                            idxMap.set(key, val);
                    }
                );
                resolvedAccessOrder.push(...compAccessOrder);
            }
        }

        return [idxMap, resolvedAccessOrder];
    }

    public getRelatedAccesses(
        source: DataContainer,
        index: number[]
    ): AccessMap<(number | undefined)[]> {
        const idxMap = new AccessMap<(number | undefined)[]>();
        
        for (const child of this.children) {
            if (child instanceof MapNode || child instanceof ComputationNode) {
                const childMap = child.getRelatedAccesses(source, index);

                for (const key of childMap.keys()) {
                    const val = childMap.get(key);

                    if (val) {
                        const targetVal = idxMap.get(key);
                        if (targetVal)
                            targetVal.concat(val);
                        else
                            idxMap.set(key, val);
                    }
                }
            }
        }

        return idxMap;
    }

    public addChild<T extends DisplayObject>(
        ...children: T[]
    ): T {
        children.forEach(child => {
            if (child instanceof Node) {
                this.nodes.add(child);
                if (child instanceof MemoryNode)
                    this.registerMemoryNode(
                        child.dataContainer, child, child.accessMode
                    );
            } else if (child instanceof Edge) {
                this.edges.add(child);
            }
        });

        return super.addChild(...children);
    }

    public removeChild(...children: DisplayObject[]): DisplayObject {
        children.forEach(child => {
            if (child instanceof Node) {
                this.nodes.delete(child);
                if (child instanceof MemoryNode) {
                    const nodes = this.memoryNodesMap.get(child.dataContainer);
                    if (nodes) {
                        for (const val of nodes) {
                            if (val[1] === child)
                                nodes.delete(val);
                        }

                        if (!nodes.size) {
                            this.memoryNodesMap.delete(child.dataContainer);
                            this.dataContainers.delete(
                                child.dataContainer.name
                            );
                        }
                    }
                }
            } else if (child instanceof Edge) {
                this.edges.delete(child);
            }
        });
        return super.removeChild(...children);
    }

    public registerMemoryNode(
        data: DataContainer, node: MemoryNode, mode: AccessMode
    ): void {
        if (this.memoryNodesMap.has(data))
            this.memoryNodesMap.get(data)?.add([mode, node]);
        else
            this.memoryNodesMap.set(data, new Set([[mode, node]]));

        this.dataContainers.set(data.name, data);
    }

    public addComputation(): void {
        return;
    }

    public setAccessPatternOverlay(enabled: boolean): void {
        this.nodes.forEach(node => {
            if (node instanceof MapNode) {
                node.showingAccessPatternControls = enabled;
                node.draw();
                node.innerGraph.setAccessPatternOverlay(enabled);
            }
        });
    }

    public enableAccessPatternOverlay(): void {
        this.setAccessPatternOverlay(true);
    }

    public disableAccessPatternOverlay(): void {
        this.setAccessPatternOverlay(false);
    }

    public setReuseDistanceOverlay(enabled: boolean): void {
        this.memoryNodesMap.forEach(nodesList => {
            nodesList.forEach(tuple => {
                const node = tuple[1];
                node.reuseDistanceOverlayActive = enabled;
                node.draw();
            });
        });
    }

    public enableReuseDistanceOverlay(): void {
        this.setReuseDistanceOverlay(true);
    }

    public disableReuseDistanceOverlay(): void {
        this.setReuseDistanceOverlay(false);
    }

    public setReuseDistanceMetric(
        metric: string, redraw: boolean = true
    ): void {
        this.memoryNodesMap.forEach(nodesList => {
            nodesList.forEach(tuple => {
                const node = tuple[1];
                node.reuseDistanceMetric = metric;
                if (redraw)
                    node.draw();
            });
        });
    }

    public setPhysMovementOverlay(enabled: boolean): void {
        this.edges.forEach(edge => {
            if (edge instanceof MemoryMovementEdge) {
                edge.physMovementOverlayActive = enabled;
                edge.draw();
            }
        });
    }

    public enablePhysMovementOverlay(): void {
        this.setPhysMovementOverlay(true);
    }

    public disablePhysMovementOverlay(): void {
        this.setPhysMovementOverlay(false);
    }

    public disableCacheLineOverlay(): void {
        this.nodes.forEach(node => {
            if (node instanceof MemoryNode) {
                node.applyToAll(undefined, (t) => {
                    t.selected = false;
                    t.showingCached = false;
                });
                node.draw();
            }
        });
    }

    public *inEdges(node: Node): Generator<Edge> {
        for (const edge of this.edges)
            if (edge.dst === node && edge.src !== node)
                yield edge;
    }

    public *outEdges(node: Node): Generator<Edge> {
        for (const edge of this.edges)
            if (edge.src === node && edge.dst !== node)
                yield edge;
    }

    public *neighborEdges(node: Node): Generator<Edge> {
        yield* this.inEdges(node);
        yield* this.outEdges(node);
    }

    public *predecessors(node: Node): Generator<Node> {
        for (const iedge of this.inEdges(node))
            yield iedge.src;
    }

    public *successors(node: Node): Generator<Node> {
        for (const oedge of this.outEdges(node))
            yield oedge.dst;
    }

    public *neighborhood(node: Node): Generator<Node> {
        yield* this.predecessors(node);
        yield* this.successors(node);
    }

}
