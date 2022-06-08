import { Graphics } from '@pixi/graphics';
import { IShape, RoundedRectangle } from '@pixi/math';
import { Text } from '@pixi/text';
import { DEFAULT_LINE_STYLE, DEFAULT_TEXT_STYLE } from '../elements/element';
import { GUIComponent } from './gui_component';

export class Button extends GUIComponent {

    private readonly borderGeometry: RoundedRectangle;
    private readonly labelGraphic: Graphics | Text;

    private hovered: boolean = false;
    private disabled: boolean = true;

    public constructor(
        private readonly clickHandler: EventListener,
        private label: string | IShape | IShape[],
        w?: number,
        h?: number,
        private readonly radius: number = 0,
        fontSize: number = 30,
    ) {
        super();

        if (typeof(this.label) === 'string') {
            this.labelGraphic = new Text(
                this.label, {
                    fontFamily: DEFAULT_TEXT_STYLE.fontFamily,
                    fontSize: fontSize,
                }
            );

            if (w === undefined)
                w = this.labelGraphic.width + 10;
            if (h === undefined)
                h = this.labelGraphic.height + 10;

            this.labelGraphic.position.set(w / 2, h / 2);
            this.labelGraphic.anchor.set(0.5);
        } else {
            this.labelGraphic = new Graphics();

            if (w === undefined || h === undefined)
                throw new Error(
                    'When using a graphical label, both height and width ' +
                    'need to be provided!'
                );
        }
        this.addChild(this.labelGraphic);

        this.borderGeometry = new RoundedRectangle(0, 0, w, h, this.radius);

        this.on('mouseover', () => {
            this.hovered = true;
            this.draw();
        });
        this.on('mouseout', () => {
            this.hovered = false;
            this.draw();
        });
        this.hitArea = this.borderGeometry;

        this.enable();

        this.draw();
    }

    public setLabelShape(shape: IShape): void {
        this.label = shape;
        this.draw();
    }

    public disable(): void {
        this.disabled = true;
        this.buttonMode = false;
        this.interactive = false;
        this.off('pointerdown');
        this.draw();
    }

    public enable(): void {
        this.disabled = false;
        this.buttonMode = true;
        this.interactive = true;
        this.on('pointerdown', this.clickHandler);
        this.draw();
    }

    public draw(): void {
        super.draw();

        if (this.labelGraphic instanceof Graphics) {
            this.labelGraphic.clear();
            this.labelGraphic.lineStyle(DEFAULT_LINE_STYLE);
            if (typeof(this.label) !== 'string' && !Array.isArray(this.label)) {
                this.labelGraphic.drawShape(this.label);
            } else if (Array.isArray(this.label)) {
                this.label.forEach(shape => {
                    (this.labelGraphic as Graphics).drawShape(shape);
                });
            }
        }

        if (this.disabled) {
            this.beginFill(0xCCCCCC, 0.8);
            this.alpha = 0.3;
        } else {
            this.alpha = 1.0;
            if (this.hovered)
                this.beginFill(0x000000, 0.1);
            else
                this.beginFill(0xFFFFFF, 1);
        }
        this.lineStyle(DEFAULT_LINE_STYLE);
        this.drawShape(this.borderGeometry);
        this.endFill();
    }

}
