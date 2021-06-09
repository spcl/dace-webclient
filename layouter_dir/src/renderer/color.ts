export default class Color {
    public static WHITE = new Color(255, 255, 255);
    public static BLACK = new Color(0, 0, 0);
    public static TRANSPARENT = new Color(0, 0, 0, 0);

    public red: number;
    public green: number;
    public blue: number;
    public alpha: number = 1;

    constructor(red: number, green: number, blue: number, alpha: number = 1) {
        this.red = red;
        this.green = green;
        this.blue = blue;
        this.alpha = alpha;
    }

    hex(): number {
        return 65536 * this.red + 256 * this.green + this.blue;
    }

    fade(alpha: number): Color {
        return new Color(this.red, this.green, this.blue, alpha);
    }
}
