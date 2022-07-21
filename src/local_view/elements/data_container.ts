// Copyright 2019-2022 ETH Zurich and the DaCe authors. All rights reserved.

import { StorageType } from '../../overlays/memory_location_overlay';
import { DataDimension } from './dimensions';

export class AccessMap<T> extends Map<DataContainer, [AccessMode, T][]> {

    constructor() {
        super();
    }

}

export enum AccessMode {
    ReadOnly,
    Write,
    ReadWrite,
}

export type DataAccess<T> = {
    dataContainer: DataContainer,
    accessMode: AccessMode,
    index: T,
};
export type SymbolicDataAccess = DataAccess<string[]>;
export type ConcreteDataAccess = DataAccess<(number | undefined)[]>;

export class DataContainer {

    public readonly strides: DataDimension[];

    constructor(
        public readonly name: string,
        public readonly dim: DataDimension[],
        public readonly elementSize: number = 1,
        public readonly startOffset: number = 0,
        public readonly alignment: number = 0,
        public storage?: StorageType,
        strides?: DataDimension[]
    ) {
        if (strides !== undefined) {
            this.strides = strides;
        } else {
            const squaredDims = this.dim.slice();
            if (squaredDims.length > 1) {
                for (let i = squaredDims.length - 2; i >= 0; i--)
                    squaredDims[i] = new DataDimension(
                        '(' + squaredDims[i].name + ')*(' +
                        squaredDims[i + 1].name + ')',
                        squaredDims[i].value * squaredDims[i + 1].value
                    );
            }

            if (squaredDims.length > 1) {
                this.strides = squaredDims.slice(1);
                this.strides.push(new DataDimension('1', 1));
            } else {
                this.strides = [
                    new DataDimension('1', 1),
                ];
            }
        }
    }

}
