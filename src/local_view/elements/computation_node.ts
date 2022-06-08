import { Text } from '@pixi/text';
import * as math from 'mathjs';
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
        parentGraph: Graph,
        private text: string,
        public readonly accessOrder: SymbolicDataAccess[],
        public drawBorder: boolean = true
    ) {
        super(parentGraph);

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

    public getAccessesFor(
        scope: any, updateParameters: boolean = false
    ): [AccessMap<(number | undefined)[]>, ConcreteDataAccess[]] {
        const idxMap = new AccessMap<(number | undefined)[]>();
        const resolvedAccessOrder: ConcreteDataAccess[] = [];

        this.accessOrder.forEach(
            val => {
                const idx: (number | undefined)[] = [];
                val.index.forEach(e => {
                    let res = undefined;
                    try {
                        res = math.evaluate(e, scope);
                        if (typeof res !== 'number')
                            res = undefined;
                    } catch (_ignored) {
                        res = undefined;
                    }
                    idx.push(res);
                });
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
        );

        return [idxMap, resolvedAccessOrder];
    }

    public getRelatedAccesses(
        source: DataContainer, index: number[]
    ): AccessMap<(number | undefined)[]> {
        const idxMap = new AccessMap<(number | undefined)[]>();

        const sourceAccesses: string[][] = [];
        this.accessOrder.forEach(val => {
            if (val.dataContainer === source)
                sourceAccesses.push(val.index);
        });

        if (sourceAccesses.length > 0) {
            const scope = new Map<string, number>();
            sourceAccesses.forEach(access => {
                access.forEach((idx: string, i: number) => {
                    if (i < index.length)
                        scope.set(idx, index[i]);
                });
            });

            for (const access of this.accessOrder) {
                if (access.dataContainer !== source) {
                    if (access.index) {
                        const idx: (number | undefined)[] = [];
                        access.index.forEach(e => {
                            let res = undefined;
                            try {
                                res = math.evaluate(e, scope);
                                if (typeof res !== 'number')
                                    res = undefined;
                            } catch (_ignored) {
                                res = undefined;
                            }
                            idx.push(res);
                        });
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
        }

        return idxMap;
    }

    public setDrawBorder(drawBorder: boolean): void {
        this.drawBorder = drawBorder;
    }

}
