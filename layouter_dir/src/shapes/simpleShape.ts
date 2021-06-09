import Box from "../geometry/box";
import EdgeShape from "./edgeShape";
import Shape from "./shape";

export default abstract class SimpleShape extends Shape {
    protected _width: number;
    protected _height: number;

    protected constructor(reference: object, x: number, y: number, width: number, height: number) {
        super(reference, x, y);
        this._width = width;
        this._height = height;
    }

    intersects(otherShape: Shape): boolean {
        if (otherShape instanceof EdgeShape) {
            return otherShape.intersects(this);
        }
        return super.intersects(otherShape);
    }

    boundingBox(): Box {
        return new Box(this._x, this._y, this._width, this._height);
    }
}
