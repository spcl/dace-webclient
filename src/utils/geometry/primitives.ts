import { EPSILON } from '../constants';

export class Vector2D {

    public constructor(
        public x: number = 0,
        public y: number = 0,
    ) {
    }

    public toString(precision: number = 0): string {
        return 'Vec(' + this.x.toFixed(precision) + ', ' +
            this.y.toFixed(precision) + ')';
    }

    public equals(other: Vector2D): boolean {
        return this.x === other.x && this.y === other.y;
    }

    public isFinite(): boolean {
        return isFinite(this.x) && isFinite(this.y);
    }

    public clone(): Vector2D {
        return new Vector2D(this.x, this.y);
    }

    public normalize(): Vector2D {
        const length = this.length();
        this.x /= length;
        this.y /= length;
        return this;
    }

    public length(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    public angle(): number {
        return (Math.atan2(this.y, this.x) + 2 * Math.PI) % (2 * Math.PI);
    }

    public scale(factor: number): Vector2D {
        this.x *= factor;
        this.y *= factor;
        return this;
    }

    public scaleToX(x: number): Vector2D {
        return this.scale(x / this.x);
    }

    public scaleToY(y: number): Vector2D {
        return this.scale(y / this.y);
    }

    public scaleToLength(length: number): Vector2D {
        const currentLength = this.length();
        if (length === 0 || currentLength === 0)
            return this.scale(0);
        return this.scale(length / currentLength);
    }

    public angleTo(other: Vector2D): number {
        return other.angle() - this.angle();
    }

    public absoluteAngleTo(other: Vector2D): number {
        return Math.abs(this.angleTo(other));
    }

    public acuteAngleTo(other: Vector2D): number {
        const absAngle = this.absoluteAngleTo(other);
        return Math.min(absAngle, Math.PI - absAngle);
    }

    public invert(): Vector2D {
        return this.scale(-1);
    }

    public subtract(other: Vector2D): Vector2D {
        this.x -= other.x;
        this.y -= other.y;
        return this;
    }

    public add(other: Vector2D): Vector2D {
        this.x += other.x;
        this.y += other.y;
        return this;
    }

    public rotate(angle: number, center?: Vector2D): Vector2D {
        if (center !== undefined)
            this.subtract(center);

        const sin = Math.sin(angle);
        const cos = Math.cos(angle);

        const newX = this.x * cos - this.y * sin;
        const newY = this.x * sin - this.y * cos;
        this.x = newX;
        this.y = newY;

        if (center !== undefined)
            this.add(center);
        return this;
    }

}

export class Box2D {

    public constructor(
        public x: number = 0,
        public y: number = 0,
        public width: number = 0,
        public height: number = 0,
    ) {
    }

    public toString(precision: number = 0): string {
        return 'Box(x: ' + this.x.toString(precision) + ', y: ' +
            this.y.toString(precision) + ', width: ' +
            this.width.toString(precision) + ', height: ' +
            this.height.toString(precision) + ')';
    }

    public topLeft(): Vector2D {
        return new Vector2D(this.left(), this.top());
    }

    public topCenter(): Vector2D {
        return new Vector2D(this.x + this.width / 2, this.top());
    }

    public topRight(): Vector2D {
        return new Vector2D(this.right(), this.top());
    }

    public center(): Vector2D {
        return new Vector2D(this.x + this.width / 2, this.y + this.height / 2);
    }

    public bottomLeft(): Vector2D {
        return new Vector2D(this.left(), this.bottom());
    }

    public bottomCenter(): Vector2D {
        return new Vector2D(this.x + this.width / 2, this.bottom());
    }

    public bottomRight(): Vector2D {
        return new Vector2D(this.right(), this.bottom());
    }

    public left(): number {
        return this.x;
    }

    public right(): number {
        return this.x + this.width;
    }

    public top(): number {
        return this.y;
    }

    public bottom(): number {
        return this.y + this.height;
    }

    public intersects(other: Box2D): boolean {
        return (this.x + EPSILON < other.x + other.width)
            && (this.x + this.width > other.x + EPSILON)
            && (this.y + EPSILON < other.y + other.height)
            && (this.y + this.height > other.y + EPSILON);
    }
    
    public isContainedIn(other: Box2D): boolean {
        return (this.x + EPSILON >= other.x)
            && (this.y + EPSILON >= other.y)
            && (this.x + this.width <= other.x + other.width + EPSILON)
            && (this.y + this.height <= other.y + other.height + EPSILON);
    }

    public centerIn(other: Box2D): Box2D {
        this.x += (other.width - this.width) / 2;
        this.y += (other.height - this.height) / 2;
        return this;
    }

}
