import Polygon from "./polygon";

export default class DownwardTrapezoid extends Polygon {
    getPath(): Array<number> {
        return [
            this._x, this._y,
            this._x + this._width, this._y,
            this._x + this._width - this._height, this._y + this._height,
            this._x + this._height, this._y + this._height,
        ];
    }
}
