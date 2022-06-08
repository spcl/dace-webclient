export class DataDimension {

    constructor(
        public readonly name: string,
        public readonly value: number,
    ) {
    }

    public toString(): string {
        return this.name;
    }

}
