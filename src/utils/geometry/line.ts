import { Box2D, Vector2D } from './primitives';

export class Line2D {

    public constructor(
        public readonly start: Vector2D,
        public readonly end: Vector2D,
    ) {
    }

    public toString(): string {
        return 'Line[' + this.start.toString() + ' -> ' +
            this.end.toString() + ']';
    }

    public getBoundingBox(): Box2D {
        const minX = Math.min(this.start.x, this.end.x);
        const minY = Math.min(this.start.y, this.end.y);
        const maxX = Math.max(this.start.x, this.end.x);
        const maxY = Math.max(this.start.y, this.end.y);
        return new Box2D(minX, minY, maxX - minX, maxY - minY);
    }

    public orientation(point: Vector2D): number {
        return Math.sign(
            (this.end.y - this.start.y) * (point.x - this.end.x) -
            (this.end.x - this.start.x) * (point.y - this.end.y)
        );
    }

    public intersects(other: Line2D): boolean {
        if (this.start.equals(other.start) || this.end.equals(other.end))
            return false;
        if (!this.getBoundingBox().intersects(other.getBoundingBox()))
            return false;
        return this.orientation(other.start) !== this.orientation(other.end) &&
            other.orientation(this.start) !== other.orientation(this.end);
    }

    public intersectsBox(other: Box2D): boolean {
        if (!this.getBoundingBox().intersects(other))
            return false;
        
        const topLeft = this.orientation(other.topLeft());
        const topRight = this.orientation(other.topRight());
        const bottomLeft = this.orientation(other.bottomLeft());
        const bottomRight = this.orientation(other.bottomRight());
        return !(topLeft === topRight &&
            topRight === bottomRight &&
            bottomRight === bottomLeft);
    }

    public getIntersection(other: Line2D): Vector2D {
        const thisInverted = this.toVector().invert();
        const otherInverted = other.toVector().invert();
        const delta = ((this.start.x - other.start.x) * otherInverted.y -
            (this.start.y - other.start.y) * otherInverted.x) /
            (thisInverted.x * otherInverted.y -
                thisInverted.y * otherInverted.x);
        return this.start.clone().add(this.toVector().scale(delta));
    }

    public toVector(): Vector2D {
        return new Vector2D(
            this.end.x - this.start.x,
            this.end.y - this.start.y
        );
    }

    public length(): number {
        const dX = this.end.x - this.start.x;
        const dY = this.end.y - this.start.y;
        return Math.sqrt(dX * dX + dY * dY);
    }

}
