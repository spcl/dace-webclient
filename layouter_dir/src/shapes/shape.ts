import * as _ from "lodash";
import Box from "../geometry/box";
import Vector from "../geometry/vector";

export default abstract class Shape {
    public reference = null;

    protected _x: number = 0;
    protected _y: number = 0;

    protected constructor(reference: object, x: number, y: number) {
        this.reference = reference;
        this._x = x;
        this._y = y;
    }

    offset(x: number, y: number): void {
        this._x += x;
        this._y += y;
    }

    position(): Vector {
        return new Vector(this._x, this._y);
    }

    clone(): Shape {
        const clone = new (this.constructor as { new() })();
        _.assign(clone, <Shape>this);
        return clone;
    }

    intersects(otherShape: Shape) {
        return this.boundingBox().intersects(otherShape.boundingBox());
    }

    abstract boundingBox(): Box;

    abstract render(container: any): void;
}
