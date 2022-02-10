import { Text } from 'pixi.js';
import { JsonSDFGNode } from '../..';
import { GraphNode } from './graph_element';

export class Tasklet extends GraphNode {

    public static readonly TYPE: string = 'Tasklet';

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
        this.labelGfx.position.set(this.textPadding);
        this.addChild(this.labelGfx);
    }

    public draw(): void {
        super.draw();
        console.log('drawing tasklet');
        console.log(this);

        const textPadding = 10;

        if (this.codeString !== undefined)
            this.labelGfx.text = this.codeString;
        else
            this.labelGfx.text = '';
        this.labelGfx.visible = true;

        const targetWidth = this.labelGfx.width + 2 * textPadding;
        const targetHeight = this.labelGfx.height + 2 * textPadding;

        this.lineStyle({
            width: 1,
            color: 0x000000,
        });
        this.drawRect(0, 0, targetWidth, targetHeight);
    }

    public get codeString(): string | undefined {
        return this.attributes.get('code')?.string_data;
    }

    public static fromJSON(value: JsonSDFGNode): Tasklet | undefined {
        if (value.type === Tasklet.TYPE && value.id !== undefined) {
            const instance = new this(value.id);

            instance.loadAttributes(value);

            return instance;
        }

        return undefined;
    }

}
