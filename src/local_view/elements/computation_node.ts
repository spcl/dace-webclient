// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import CoffeeQuate from 'coffeequate';
import * as math from 'mathjs';
import { Text } from 'pixi.js';
import { Graph } from '../graph/graph';
import { LViewRenderer } from '../lview_renderer';
import {
    AccessMap,
    ConcreteDataAccess,
    DataContainer,
    SymbolicDataAccess,
} from './data_container';
import { DEFAULT_LINE_STYLE, DEFAULT_TEXT_STYLE } from './element';
import { Node } from './node';

const CNODE_INTERNAL_PADDING: number = 10;

const RELATE_INCLUSIVE: boolean = false;

export class ComputationNode extends Node {

    private label: Text;

    constructor(
        id: string,
        parentGraph: Graph,
        public readonly text: string,
        public readonly accessOrder: SymbolicDataAccess[],
        public readonly farText: string | undefined = undefined,
        public drawBorder: boolean = true,
        renderer?: LViewRenderer
    ) {
        super(parentGraph, id, renderer);

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
        scope: Record<string, any>
    ): [AccessMap, ConcreteDataAccess[]] {
        const idxMap = new AccessMap();
        const resolvedAccessOrder: ConcreteDataAccess[] = [];

        for (const val of this.accessOrder) {
            const idx: (number | undefined)[] = [];
            for (const e of val.index) {
                let res = undefined;
                try {
                    res = math.evaluate(e, scope) as unknown;
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
     * Find all related memory accesses for a given scope and source container.
     * For a given symbol scope, this method appends all data accesses to an
     * index map, which are related to accesses to the given source container
     * under that symbol scope.
     *
     * For example:
     * - On a computation node calculating C[i, j] = A[i, j] + B[i, j].
     * - Given A as the source container and a symbol scope of { i: 1, j: 3 }.
     * - Appends the accesses to C[1, 3] and B[1, 3] to the provided index map.
     *
     * Unknown / undefined symbols under the provided scope are taken all the
     * way from their minium to their maximum value. In the example above,
     * if i is in [0:N] and j is in [0:M], if the provided scope is only
     * { i: 1 }, the appended accesses are: C[1, 0:M] and B[1, 0:M].
     * @param source Source container from where to check for related accesses
     * @param scope  Symbol scope under which to check for related accesses
     * @param idxMap Index map to which accesses are appended
     */
    private findRelatedFromScope(
        source: DataContainer, scope: Map<string, number>,
        idxMap: AccessMap
    ): void {
        for (const access of this.accessOrder) {
            if (!RELATE_INCLUSIVE && access.dataContainer === source)
                continue;
            const idx: (number | undefined)[] = [];
            for (const e of access.index) {
                let res = undefined;
                try {
                    res = math.evaluate(e, scope) as unknown;
                    if (typeof res !== 'number')
                        res = undefined;
                } catch (_ignored) {
                    res = undefined;
                }
                idx.push(res);
            }
            const prev = idxMap.get(access.dataContainer);
            if (prev !== undefined) {
                prev.push([access.accessMode, idx]);
            } else {
                idxMap.set(
                    access.dataContainer,
                    [[access.accessMode, idx]]
                );
            }
        }
    }

    /**
     * For a given data container and numeric index, get all related accesses.
     * @param source    Source data container
     * @param index     Numeric index in source data container
     * @param _origin    The node asking for related accesses
     * @returns         Access map of related accesses
     */
    public getRelatedAccesses(
        source: DataContainer, index: number[], _origin?: Node
    ): AccessMap {
        const idxMap = new AccessMap();

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
        if (sourceAccesses.length > 0) {
            const scope = new Map<string, number>();
            sourceAccesses[0].forEach((idx: string, i: number) => {
                if (i < index.length) {
                    const rightHand = index[i];
                    const leftHand = idx;
                    /* eslint-disable @typescript-eslint/no-unsafe-assignment */
                    /* eslint-disable @typescript-eslint/no-unsafe-call */
                    /* eslint-disable
                       @typescript-eslint/no-unsafe-member-access */
                    const equation = CoffeeQuate(
                        leftHand.toString() + ' = ' + rightHand.toString()
                    );
                    const variables = equation.getAllVariables();
                    if (variables.length === 1) {
                        const solutions = equation.solve(
                            variables[0]
                        ) as number[];
                        if (solutions.length === 1) {
                            scope.set(
                                variables[0] as string,
                                math.evaluate(solutions[0].toString()) as number
                            );
                        }
                    }
                    /* eslint-enable
                       @typescript-eslint/no-unsafe-member-access */
                    /* eslint-enable @typescript-eslint/no-unsafe-call */
                    /* eslint-enable @typescript-eslint/no-unsafe-assignment */
                }
            });
            this.findRelatedFromScope(source, scope, idxMap);
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
