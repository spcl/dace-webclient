import { Graphics } from '@pixi/graphics';
import { DisplayObject } from 'pixi.js';
import { ComputationNode } from '../elements/computation_node';
import {
    AccessMap,
    AccessMode,
    ConcreteDataAccess,
    DataContainer,
} from '../elements/data_container';
import { Edge } from '../elements/edge';
import { Element } from '../elements/element';
import { MapNode } from '../elements/map_node';
import { MemoryMovementEdge } from '../elements/memory_movement_edge';
import { MemoryNode } from '../elements/memory_node';
import { Node } from '../elements/node';

type MemoryNodeMap = Map<DataContainer, [AccessMode, MemoryNode][]>;

export class Graph extends Graphics {

    public readonly memoryNodesMap: MemoryNodeMap = new Map();
    public readonly dataContainers: Map<string, DataContainer> = new Map();

    public readonly nodes: Node[] = [];
    public readonly edges: Edge[] = [];

    public constructor() {
        super();
    }

    public draw(): void {
        this.clear();
        this.children.forEach(child => {
            if (child instanceof Element)
                child.draw();
        });
    }

    public getAccessesFor(
        scope: Map<string, number>, updateParameters: boolean = false
    ): [
        AccessMap<(number | undefined)[]>, ConcreteDataAccess[]
    ] {
        const idxMap = new AccessMap<(number | undefined)[]>();
        const resolvedAccessOrder: ConcreteDataAccess[] = [];

        this.children.forEach(child => {
            if (child instanceof MapNode ||
                child instanceof ComputationNode) {
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
        });

        return [idxMap, resolvedAccessOrder];
    }

    public getRelatedAccesses(
        source: DataContainer,
        index: number[]
    ): AccessMap<(number | undefined)[]> {
        const idxMap = new AccessMap<(number | undefined)[]>();
        
        this.children.forEach(child => {
            if (child instanceof MapNode ||
                child instanceof ComputationNode) {
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
        });

        return idxMap;
    }

    public addChild(...children: DisplayObject[]): DisplayObject {
        children.forEach(child => {
            if (child instanceof Node)
                this.nodes.push(child);
            else if (child instanceof Edge)
                this.edges.push(child);
        });

        return super.addChild(...children);
    }

    public registerMemoryNode(
        data: DataContainer, node: MemoryNode, mode: AccessMode
    ): void {
        if (this.memoryNodesMap.has(data))
            this.memoryNodesMap.get(data)?.push([mode, node]);
        else
            this.memoryNodesMap.set(data, [[mode, node]]);

        this.dataContainers.set(data.name, data);
    }

    public addComputation(): void {
        return;
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

    public hasDataContainer(name: string): boolean {
        for (const container of this.memoryNodesMap) {
            console.log(container);
        }
        return true;
    }

}
