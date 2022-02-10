import { Text } from 'pixi.js';
import { JsonSDFGNode } from '../..';
import { GraphNode } from './graph_element';

export class AccessNode extends GraphNode {

    public static readonly TYPE: string = 'AccessNode';

    private labelGfx?: Text;

    public constructor(id: number) {
        super(id);
    }

    public draw(): void {
        super.draw();

        // TODO: Text padding should be configurable or at least pulled out
        //  into a global constants file.
        const textPadding = 10;

        if (this.dataName !== undefined) {
            if (this.labelGfx !== undefined) {
                this.labelGfx.text = this.dataName;
            } else {
                // TODO: Font settings should be configurable.
                this.labelGfx = new Text(
                    this.dataName, {
                        fontFamily: 'Montserrat',
                        fontSize: 18,
                    }
                );
                this.labelGfx.position.set(2 * textPadding, textPadding);
                this.addChild(this.labelGfx);
            }
        }

        this.lineStyle({
            width: 1,
            color: 0x000000,
        });
        this.drawEllipse(
            this.height / 2 + textPadding, this.width / 2 + 2 * textPadding,
            this.width + 4 * textPadding, this.height + 2 * textPadding
        );
    }

    public get dataName(): string | undefined {
        return this.attributes.get('data');
    }

    public static fromJSON(value: JsonSDFGNode): AccessNode | undefined {
        if (value.type === AccessNode.TYPE && value.id !== undefined) {
            const instance = new this(value.id);

            instance.loadAttributes(value);

            return instance;
        }

        return undefined;
    }

}
