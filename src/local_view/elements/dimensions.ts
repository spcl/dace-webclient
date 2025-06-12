// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

export class DataDimension {

    constructor(
        public readonly name: string,
        public readonly value: number
    ) {
    }

    public toString(): string {
        return this.name;
    }

}
