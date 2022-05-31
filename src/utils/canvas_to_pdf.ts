import BlobStream from 'blob-stream';
import PDFKit from 'pdfkit';

type FontDesc = {
    style: string,
    size: number,
    family: string,
    weight: string,
};

const DEFAULT_FONT_STYLE = 'normal';
const DEFAULT_FONT_FAMILY = 'Helvetica';
const DEFAULT_FONT_SIZE = 10;
const DEFAULT_FONT_WEIGHT = 'normal';

type PDFContextOptions = {
    textAlign: string,
    textBaseline: string,
    pdfOptions: PDFKit.PDFDocumentOptions,
};

export class PDFContext {

    public readonly stream: BlobStream.IBlobStream;
    private document: PDFKit.PDFDocument;

    private readonly fontRegex = /^\s*(?=(?:(?:[-a-z]+\s*){0,2}(italic|oblique))?)(?=(?:(?:[-a-z]+\s*){0,2}(small-caps))?)(?=(?:(?:[-a-z]+\s*){0,2}(bold(?:er)?|lighter|[1-9]00))?)(?:(?:normal|\1|\2|\3)\s*){0,3}((?:xx?-)?(?:small|large)|medium|smaller|larger|[.\d]+(?:\%|in|[cem]m|ex|p[ctx]))(?:\s*\/\s*(normal|[.\d]+(?:\%|in|[cem]m|ex|p[ctx])))?\s*([-,\'\"\sa-z]+?)\s*$/i;

    constructor(
        public readonly options: PDFContextOptions,
    ) {
        this.document = new PDFKit(options.pdfOptions);
        this.stream = this.document.pipe(BlobStream());
    }

    private parseFont(font: string): FontDesc {
        const fontPart = this.fontRegex.exec(font);

        if (fontPart === null)
            return {
                style: DEFAULT_FONT_STYLE,
                size: DEFAULT_FONT_SIZE,
                family: DEFAULT_FONT_FAMILY,
                weight: DEFAULT_FONT_WEIGHT,
            };

        return {
            style: fontPart[1] || DEFAULT_FONT_STYLE,
            size: parseInt(fontPart[4]) || DEFAULT_FONT_SIZE,
            family: fontPart[6] || DEFAULT_FONT_FAMILY,
            weight: fontPart[3] || DEFAULT_FONT_WEIGHT,
        };
    }

    public end(): void {
        this.document.end();
    }

    public save(): PDFKit.PDFDocument {
        return this.document.save();
    }

    public restore(): PDFKit.PDFDocument {
        return this.document.restore();
    }

    public scale(
        xFactor: number, yFactor?: number, options?: { origin?: number[] }
    ): PDFKit.PDFDocument {
        return this.document.scale(xFactor, yFactor, options);
    }

    public rotate(
        angle: number, options?: { origin?: number[] }
    ): PDFKit.PDFDocument {
        return this.document.rotate(angle, options);
    }

    public translate(x: number, y: number): PDFKit.PDFDocument {
        return this.document.translate(x, y);
    }

    public beginPath(): void {
        // No-Op.
    }

    public moveTo(x: number, y: number): PDFKit.PDFDocument {
        return this.document.moveTo(x, y);
    }

    public closePath(): PDFKit.PDFDocument {
        return this.document.closePath();
    }

    public lineTo(x: number, y: number): PDFKit.PDFDocument {
        return this.document.lineTo(x, y);
    }

    public stroke(color?: PDFKit.Mixins.ColorValue): PDFKit.PDFDocument {
        return this.document.stroke(color);
    }

    public fill(
        color?: PDFKit.Mixins.ColorValue, rule?: PDFKit.Mixins.RuleValue
    ): PDFKit.PDFDocument {
        return this.document.fill(color, rule);
    }

    public rect(
        x: number, y: number, w: number, h: number
    ): PDFKit.PDFDocument {
        return this.document.rect(x, y, w, h);
    }

    public fillRect(
        x: number, y: number, w: number, h: number,
        color?: PDFKit.Mixins.ColorValue, rule?: PDFKit.Mixins.RuleValue
    ): PDFKit.PDFDocument {
        return this.rect(x, y, w, h).fill(color, rule);
    }

    public strokeRect(
        x: number, y: number, w: number, h: number,
        color?: PDFKit.Mixins.ColorValue
    ): PDFKit.PDFDocument {
        return this.rect(x, y, w, h).stroke(color);
    }

    public clearRect(
        x: number, y: number, w: number, h: number
    ): PDFKit.PDFDocument {
        return this.fillRect(x, y, w, h, 'white');
    }

    public arc(
        x: number, y: number, r: number, a0: number, a1: number, ccw: number
    ): PDFKit.PDFDocument {
        const tau = 2 * Math.PI;
        const eps = 1e-6;

        const dx = r * Math.cos(a0);
        const dy = r * Math.sin(a0);
        const x0 = x + dx;
        const y0 = y + dy;
        const cw = 1 ^ ccw;
        let da = ccw ? a0 - a1 : a1 - a0;

        if (r < 0)
            throw new Error('Negative radius :' + r);

        let cmd = 'M' + x0 + ',' + y0;

        if (!r)
            return this.document;

        if (da < 0)
            da = da % tau + tau;

        if (da > (tau - eps))
            cmd += 'A' + r + ',' + r + ',0,1,' + cw + ',' + (x - dx) + ',' +
                (y - dy) + 'A' + r + ',' + r + ',0,1,' + cw + ',' + x0 + ',' +
                y0;
        else if (da > eps)
            cmd += 'A' + r + ',' + r + ',0,' + (+(da >= Math.PI)) + ',' + cw +
                ',' + ( x + r * Math.cos(a1)) + ',' + (y + r * Math.sin(a1));

        return this.document.path(cmd);
    }

    public bezierCurveTo(
        cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number,
        y: number
    ): PDFKit.PDFDocument {
        return this.document.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
    }

    public quadraticCurveTo(
        cpx: number, cpy: number, x: number, y: number
    ): PDFKit.PDFDocument {
        return this.document.quadraticCurveTo(cpx, cpy, x, y);
    }

    public createLinearGradient(
        x1: number, y1: number, x2: number, y2: number
    ): PDFKit.PDFLinearGradient {
        const gradient = this.document.linearGradient(x1, y1, x2, y2);
        // TODO: fix colors.
        return gradient;
    }

    public createRadialGradient(
        x1: number, y1: number, r1: number, x2: number, y2: number, r2: number
    ): PDFKit.PDFRadialGradient {
        const gradient = this.document.radialGradient(x1, y1, r1, x2, y2, r2);
        return gradient;
    }

    public adjustTextX(text: string, x: number): number {
        const width = this.document.widthOfString(text);
        switch (this.options.textAlign) {
            case 'right':
            case 'end':
                return x - width;
            case 'center':
                return x - (width / 2);
            default:
                return x;
        }
    }

    public adjustTextY(text: string, y: number): number {
        const height = this.document.currentLineHeight(false);
        switch (this.options.textBaseline) {
            case 'bottom':
                return y - height;
            case 'middle':
                return y - (height / 2);
            case 'alphabetic':
                return y - ((height / 2) + 1);
            default:
                return y;
        }
    }

    public fillText(
        text: string, x: number, y: number, options?: PDFKit.Mixins.TextOptions
    ): PDFKit.PDFDocument {
        const nX = this.adjustTextX(text, x);
        const nY = this.adjustTextY(text, y);
        if (!options)
            options = {};
        options.lineBreak = false;
        options.stroke = false;
        options.fill = true;
        return this.document.text(text, nX, nY, options);
    }

    public strokeText(
        text: string, x: number, y: number, options?: PDFKit.Mixins.TextOptions
    ): PDFKit.PDFDocument {
        const nX = this.adjustTextX(text, x);
        const nY = this.adjustTextY(text, y);
        if (!options)
            options = {};
        options.lineBreak = false;
        options.stroke = true;
        options.fill = false;
        return this.document.text(text, nX, nY, options);
    }

    public measureText(text: string): { width: number, height: number } {
        const width = this.document.widthOfString('' + text);
        return {
            width: width,
            height: this.document.currentLineHeight(false),
        };
    }

    public clip(rule?: PDFKit.Mixins.RuleValue): PDFKit.PDFDocument {
        return this.document.clip(rule);
    }

    public drawImage(
        image: any, x?: number, y?: number, options?: PDFKit.Mixins.ImageOption
    ): PDFKit.PDFDocument {
        if (image.nodeName === 'IMG') {
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            canvas.getContext('2d')?.drawImage(image, 0, 0);
            const dataUrl = canvas.toDataURL('image/png');
            return this.document.image(dataUrl, x, y, options);
        } else {
            return this.document.image(image, x, y, options);
        }
    }

}
