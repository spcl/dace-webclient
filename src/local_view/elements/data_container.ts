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
        public readonly inverse: boolean = false,
        public readonly elementSize: number = 1,
        public readonly startOffset: number = 0,
        public readonly alignment: number = 0,
        strides?: DataDimension[]
    ) {
        if (strides !== undefined) {
            this.strides = strides;
        } else {
            const squaredDims = this.dim.slice();
            if (squaredDims.length > 1) {
                if (inverse) {
                    for (let i = 1; i < squaredDims.length; i++)
                        squaredDims[i] = new DataDimension(
                            '(' + squaredDims[i].name + ')*(' +
                            squaredDims[i - 1].name + ')',
                            squaredDims[i].value * squaredDims[i - 1].value
                        );
                } else {
                    for (let i = squaredDims.length - 2; i >= 0; i--)
                        squaredDims[i] = new DataDimension(
                            '(' + squaredDims[i].name + ')*(' +
                            squaredDims[i + 1].name + ')',
                            squaredDims[i].value * squaredDims[i + 1].value
                        );
                }
            }

            if (squaredDims.length > 1) {
                if (inverse)
                    squaredDims.reverse();
                this.strides = squaredDims.slice(1);
                if (inverse)
                    this.strides.unshift(new DataDimension('1', 1));
                else
                    this.strides.push(new DataDimension('1', 1));
            } else {
                this.strides = [
                    new DataDimension('1', 1),
                ];
            }
        }
    }

}
