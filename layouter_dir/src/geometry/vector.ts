/**
 * Inspired by THREE.js: https://github.com/mrdoob/three.js/
 */

export default class Vector {
    public x: number;
    public y: number;

    constructor(x: number = 0, y: number = 0) {
        this.x = x;
        this.y = y;
    }

    toString(precision: number = 0): string {
        return "(" + this.x.toFixed(precision) + " / " + this.y.toFixed(precision) + ")";
    }

    clone(): Vector {
        return new Vector(this.x, this.y);
    }

    length(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    angle(): number {
        return (Math.atan2(this.y, this.x) + 2 * Math.PI) % (2 * Math.PI);
    }

    normalize(): Vector {
        const length = this.length();
        this.x /= length;
        this.y /= length;
        return this;
    }

    setX(x: number): Vector {
        return this.multiplyScalar(x / this.x);
    }

    setY(y: number): Vector {
        return this.multiplyScalar(y / this.y);
    }

    angleTo(otherVector: Vector): number {
        return otherVector.angle() - this.angle();
    }

    absoluteAngleTo(otherVector: Vector): number {
        return Math.abs(this.angleTo(otherVector));
    }

    acuteAngleTo(otherVector: Vector): number {
        const absAngle = this.absoluteAngleTo(otherVector);
        return Math.min(absAngle, Math.PI - absAngle);
    }

    multiplyScalar(scalar: number): Vector {
        this.x *= scalar;
        this.y *= scalar;
        return this;
    }

    invert(): Vector {
        return this.multiplyScalar(-1);
    }

    rotateAround(center: Vector, angle: number): Vector {
        this.sub(center);
        const sin = Math.sin(angle);
        const cos = Math.cos(angle);
        const x = this.x * cos - this.y * sin;
        this.y = this.x * sin + this.y * cos;
        this.x = x;
        this.add(center);
        return this;
    }

    add(otherVector: Vector): Vector {
        this.x += otherVector.x;
        this.y += otherVector.y;
        return this;
    }

    sub(otherVector: Vector): Vector {
        this.x -= otherVector.x;
        this.y -= otherVector.y;
        return this;
    }
}
