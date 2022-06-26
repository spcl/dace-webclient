import * as math from 'mathjs';
import { Text } from 'pixi.js';
import { Graph } from '../graph/graph';
import {
    AccessMap,
    ConcreteDataAccess,
    DataContainer,
    SymbolicDataAccess
} from './data_container';
import { DEFAULT_LINE_STYLE, DEFAULT_TEXT_STYLE } from './element';
import { Node } from './node';

const CNODE_INTERNAL_PADDING: number = 10;

export class ComputationNode extends Node {

    private label: Text;

    constructor(
        id: string,
        parentGraph: Graph,
        public readonly text: string,
        public readonly accessOrder: SymbolicDataAccess[],
        public readonly farText: string | undefined = undefined,
        public drawBorder: boolean = true
    ) {
        super(parentGraph, id);

        this.label = new Text(this.text, DEFAULT_TEXT_STYLE);
        this.label.position.set(CNODE_INTERNAL_PADDING);
        this.addChild(this.label);

        this.draw();
    }

    public draw(): void {
        super.draw();

        // If we don't want to draw the border, we don't set a line style so the
        // rectangle remains invisible.
        if (this.drawBorder)
            this.lineStyle(DEFAULT_LINE_STYLE);

        this.drawRect(
            0, 0, this.label.width + (2 * CNODE_INTERNAL_PADDING),
            this.label.height + (2 * CNODE_INTERNAL_PADDING)
        );
    }

    /**
     * Given a specific symbol scope, get all accesses related to this node.
     * This returns an access map (mapping data containers to the accesses to
     * them), and an ordered list of concrete data accesses.
     * @param scope Symbol scope
     * @returns     Access map and ordered list of concrete accesses as a tuple
     */
    public getAccessesFor(
        scope: any
    ): [AccessMap<(number | undefined)[]>, ConcreteDataAccess[]] {
        const idxMap = new AccessMap<(number | undefined)[]>();
        const resolvedAccessOrder: ConcreteDataAccess[] = [];

        for (const val of this.accessOrder) {
            const idx: (number | undefined)[] = [];
            for (const e of val.index) {
                let res = undefined;
                try {
                    res = math.evaluate(e, scope);
                    if (typeof res !== 'number')
                        res = undefined;
                } catch (_ignored) {
                    res = undefined;
                }
                idx.push(res);
            }
            resolvedAccessOrder.push({
                dataContainer: val.dataContainer,
                accessMode: val.accessMode,
                index: idx,
            });
            const prev = idxMap.get(val.dataContainer);
            if (prev !== undefined)
                prev.push([val.accessMode, idx]);
            else
                idxMap.set(val.dataContainer, [[val.accessMode, idx]]);
        }

        return [idxMap, resolvedAccessOrder];
    }

    /**
     * For a given data container and numeric index, get all related accesses.
     * @param source    Source data container
     * @param index     Numeric index in source data container
     * @returns         Access map of related accesses
     */
    public getRelatedAccesses(
        source: DataContainer, index: number[]
    ): AccessMap<(number | undefined)[]> {
        const idxMap = new AccessMap<(number | undefined)[]>();

        // Find out what symbolic accesses the numeric indices to the source
        // relate to.
        const sourceAccesses: string[][] = [];
        this.accessOrder.forEach(val => {
            if (val.dataContainer === source)
                sourceAccesses.push(val.index);
        });

        // Construct a scope which reflects the symbol values that result in
        // this data access. We can use this to deduce further data accesses
        // based on symbolic indices.
        const scope = new Map<string, number>();
        if (sourceAccesses.length > 0) {
            for (const access of sourceAccesses) {
                access.forEach((idx: string, i: number) => {
                    if (i < index.length)
                        scope.set(idx, index[i]);
                });
            }

            for (const access of this.accessOrder) {
                if (access.dataContainer !== source) {
                    if (access.index) {
                        const idx: (number | undefined)[] = [];
                        for (const e of access.index) {
                            let res = undefined;
                            try {
                                res = math.evaluate(e, scope);
                                if (typeof res !== 'number')
                                    res = undefined;
                            } catch (_ignored) {
                                res = undefined;
                            }
                            idx.push(res);
                        }
                        const prev = idxMap.get(access.dataContainer);
                        if (prev !== undefined)
                            prev.push([access.accessMode, idx]);
                        else
                            idxMap.set(
                                access.dataContainer, [[access.accessMode, idx]]
                            );
                    }
                }
            }

            const [superAccessMap, _] = this.parentGraph.getAccessesFor(scope);
            superAccessMap.forEach((val, key) => {
                const prev = idxMap.get(key);
                if (prev)
                    idxMap.set(key, val.concat(prev));
                else
                    idxMap.set(key, val);
            });
        }

        return idxMap;
    }

    public setDrawBorder(drawBorder: boolean): void {
        this.drawBorder = drawBorder;
    }

    public get unscaledWidth(): number {
        return this.label.width + (2 * CNODE_INTERNAL_PADDING);
    }

    public get unscaledHeight(): number {
        return this.label.height + (2 * CNODE_INTERNAL_PADDING);
    }

}
