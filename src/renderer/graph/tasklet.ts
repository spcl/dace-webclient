import { Text } from 'pixi.js';
import { JsonSDFGNode } from '../..';
import { Graph } from './graph';
import { GraphNode, ScopedNode } from './graph_element';

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

    public type(): string {
        return Tasklet.TYPE;
    }

    public draw(): void {
        super.draw();

        let border = true;
        if (this.parent instanceof Graph &&
            this.parent.parent instanceof ScopedNode) {
            border = this.parent.nodes().length > 1;
        }

        this.drawSelf(border);
    }

    private drawSelf(border: boolean = true): void {
        // Draw the correct label.
        if (this.codeString !== undefined)
            this.labelGfx.text = this.codeString;
        else
            this.labelGfx.text = '';

        this.labelGfx.visible = true;

        if (this.layoutNode) {
            const pos = {
                x: this.layoutNode.x,
                y: this.layoutNode.y,
            };
            const lPos = this.parent.toLocal(pos);
            this.position.set(lPos.x, lPos.y);

            if (border) {
                this.lineStyle({
                    width: 1,
                    color: 0x000000,
                });
                this.drawRect(
                    0, 0, this.layoutNode.width, this.layoutNode.height
                );
            }
        } else {
            const targetWidth =
                this.labelGfx.width + 2 * this.textPadding;
            const targetHeight =
                this.labelGfx.height + 2 * this.textPadding;
            
            if (border) {
                this.lineStyle({
                    width: 1,
                    color: 0x000000,
                });
                this.drawRect(0, 0, targetWidth, targetHeight);
            }
        }
    }

    public get codeString(): string | undefined {
        return this.attributes.get('code')?.string_data;
    }

    public static fromJSON(value: JsonSDFGNode): Tasklet | undefined {
        if (value.type === Tasklet.TYPE && value.id !== undefined) {
            const instance = new this(value.id);

            instance.loadAttributes(value);

            instance.drawSelf();

            return instance;
        }

        return undefined;
    }

}
