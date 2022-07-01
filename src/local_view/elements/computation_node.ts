// Copyright 2019-2022 ETH Zurich and the DaCe authors. All rights reserved.

import CoffeeQuate from 'coffeequate';
import * as math from 'mathjs';
import { Text } from 'pixi.js';
import { Graph } from '../graph/graph';
import { LViewRenderer } from '../lview_renderer';
import {
    AccessMap,
    ConcreteDataAccess,
    DataContainer,
    SymbolicDataAccess
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
        renderer?: LViewRenderer,
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

    private findRelatedFromScope(
        source: DataContainer, scope: Map<string, number>,
        idxMap: AccessMap<(number | undefined)[]>
    ): void {
        for (const access of this.accessOrder) {
            if (!RELATE_INCLUSIVE && access.dataContainer === source)
                continue;
            if (access.index) {
                const idx: (number | undefined)[] = [];
                for (const e of access.index) {
                    let res = undefined;
                    try {
                        res = math.evaluate(e.replaceAll('_', ''), scope);
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
     * @param origin    The node asking for related accesses
     * @returns         Access map of related accesses
     */
    public getRelatedAccesses(
        source: DataContainer, index: number[], origin?: Node
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
        if (sourceAccesses.length > 0) {
            const scope = new Map<string, number>();
            sourceAccesses[0].forEach((idx: string, i: number) => {
                if (i < index.length) {
                    const rightHand = index[i];
                    const leftHand = idx;
                    // TODO: Having to replace underscores here is ugly. We
                    // should be avoiding them alltogether.
                    const equation = CoffeeQuate(
                        leftHand.toString().replaceAll('_', '') + ' = ' +
                        rightHand.toString()
                    );
                    const variables = equation.getAllVariables();
                    if (variables.length === 1) {
                        const solutions = equation.solve(variables[0]);
                        if (solutions.length === 1)
                            scope.set(
                                variables[0],
                                math.evaluate(solutions[0].toString())
                            );
                    }
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
