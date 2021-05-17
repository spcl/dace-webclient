import Polygon from "./polygon";

export default class Octagon extends Polygon {
    getPath(): Array<number> {
        const octSeg = this._height / 3.0;
        return [
            this._x, this._y + octSeg,
            this._x + octSeg, this._y,
            this._x + this._width - octSeg, this._y,
            this._x + this._width, this._y + octSeg,
            this._x + this._width, this._y + 2 * octSeg,
            this._x + this._width - octSeg, this._y + this._height,
            this._x + octSeg, this._y + this._height,
            this._x, this._y + 2 * octSeg,
        ];
    }
}
