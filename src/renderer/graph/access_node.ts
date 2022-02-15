import { Point, Text } from 'pixi.js';
import { JsonSDFGNode } from '../..';
import { GraphNode } from './graph_element';

export class AccessNode extends GraphNode {

    public static readonly TYPE: string = 'AccessNode';

    // TODO: Text padding should be configurable or at least pulled out
    //  into a global constants file.
    private readonly textPadding: number = 10;
    private readonly labelGfx: Text = new Text('');

    public constructor(id: number) {
        super(id);

        // TODO: Font settings should be configurable.
        this.labelGfx.style.fontFamily = 'Montserrat';
        this.labelGfx.style.fontSize = 18;

        this.labelGfx.visible = false;
        this.labelGfx.anchor.set(0.5);
        this.labelGfx.position.set(0);
        this.addChild(this.labelGfx);
    }

    public type(): string {
        return AccessNode.TYPE;
    }

    public draw(): void {
        super.draw();
        this.drawSelf();
    }

    private drawSelf(): void {
        if (this.dataName !== undefined)
            this.labelGfx.text = this.dataName;
        else
            this.labelGfx.text = '';

        this.labelGfx.visible = true;

        if (this.layoutNode) {
            const pos = {
                x: this.layoutNode.x,
                y: this.layoutNode.y,
            };
            const lPos = this.parent.toLocal(pos);
            this.position.set(
                lPos.x + this.layoutNode.width / 2,
                lPos.y + this.layoutNode.height / 2
            );

            this.lineStyle({
                width: 1,
                color: 0x000000,
            });
            this.drawEllipse(
                0, 0, this.layoutNode.width / 2,
                this.layoutNode.height / 2
            );
        } else {
            const targetWidth =
                this.labelGfx.width / 2 + this.textPadding;
            const targetHeight =
                this.labelGfx.height / 2 + this.textPadding / 2;

            this.lineStyle({
                width: 1,
                color: 0x000000,
            });
            this.drawEllipse(0, 0, targetWidth, targetHeight);
        }
    }

    public get dataName(): string | undefined {
        return this.attributes.get('data');
    }

    public static fromJSON(value: JsonSDFGNode): AccessNode | undefined {
        if (value.type === AccessNode.TYPE && value.id !== undefined) {
            const instance = new this(value.id);

            instance.loadAttributes(value);

            instance.drawSelf();

            return instance;
        }

        return undefined;
    }

}
