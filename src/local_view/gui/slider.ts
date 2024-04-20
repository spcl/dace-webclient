// Copyright 2019-2022 ETH Zurich and the DaCe authors. All rights reserved.

import { Graphics, Text } from 'pixi.js';
import { GUIComponent } from './gui_component';

const SLIDER_PADDING: number = 30;

export class Slider extends GUIComponent {

    private val: number;
    private valueChangedHandler: ((val: number) => void) | null = null;

    private dragging: boolean = false;

    private minText: Text;
    private maxText: Text;
    private valText: Text;
    private pommel: Graphics;

    private lineY: number;
    private lineSegmentLength: number;
    private minPommelX: number;
    private maxPommelX: number;

    public constructor(
        private min: number,
        private max: number,
        private step: number,
        private sliderWidth: number,
        private readonly lineThickness: number = 2,
        private readonly lineColor: number = 0x000000,
        private readonly pommelRadius: number = 6,
        private readonly pommelColor: number = 0x444444
    ) {
        super();

        this.val = min;
        this.lineY = (this.pommelRadius + 5) - (this.lineThickness / 2);

        // Create the pommel to change the value.
        this.minPommelX = SLIDER_PADDING + this.pommelRadius;
        this.maxPommelX = sliderWidth - (SLIDER_PADDING + this.pommelRadius);
        const lineWidth = (sliderWidth - (2 * SLIDER_PADDING)) -
            (2 * this.pommelRadius);
        this.lineSegmentLength = lineWidth / (this.max - this.min);
        this.pommel = new Graphics();
        this.pommel.interactive = true;
        this.pommel.buttonMode = true;
        this.pommel.position.set(this.minPommelX, this.lineY);
        this.pommel.on('pointerdown', () => {
            this.dragging = true;
            this.draw();
        });
        this.pommel.on('pointerup', () => {
            this.dragging = false;
            this.draw();
        });

        // Ensure if dragging is let go, stop dragging even if the event is not
        // captured by the pommel itself (i.e. mouse outside of the pommel).
        window.addEventListener('mouseup', () => {
            if (this.dragging) {
                this.dragging = false;
                this.draw();
            }
        });

        this.pommel.on('pointermove', (event) => {
            if (this.dragging) {
                let targetX = event.data.getLocalPosition(this).x;
                if (targetX > this.maxPommelX)
                    targetX = this.maxPommelX;
                if (targetX < this.minPommelX)
                    targetX = this.minPommelX;
                this.pommel.position.x = targetX;
                this.valText.position.x = targetX;

                const xOffset = targetX - this.minPommelX;
                const nValOffset = Math.floor(xOffset / this.lineSegmentLength);
                const nVal = this.min + nValOffset;
                if (this.val !== nVal && nVal % this.step === 0) {
                    this.val = nVal;
                    this.valText.text = nVal.toString();
                    if (this.valueChangedHandler !== null)
                        this.valueChangedHandler(this.val);
                }

                this.draw();

                event.stopPropagation();
            }
        });
        this.addChild(this.pommel);

        // Draw text labels for the minimum, maximum, and current value.
        this.minText = new Text(this.min.toString(), {
            fontFamily: 'Montserrat',
            fontSize: 16,
        });
        this.minText.anchor.set(0.5);
        this.minText.position.set(SLIDER_PADDING / 2, this.lineY);
        this.addChild(this.minText);

        this.maxText = new Text(this.max.toString(), {
            fontFamily: 'Montserrat',
            fontSize: 16,
        });
        this.maxText.anchor.set(0.5);
        this.maxText.position.set(
            sliderWidth - (SLIDER_PADDING / 2), this.lineY
        );
        this.addChild(this.maxText);

        this.valText = new Text(this.val.toString(), {
            fontFamily: 'Montserrat',
            fontSize: 16,
        });
        this.valText.anchor.set(0.5, 0);
        this.valText.position.set(
            this.pommel.x, this.lineY + this.pommelRadius + 5
        );
        this.addChild(this.valText);
    }

    public draw(): void {
        super.draw();

        // Draw the slider line.
        this.moveTo(SLIDER_PADDING, this.lineY);
        this.lineStyle({
            color: this.lineColor,
            width: this.lineThickness,
        });
        this.lineTo(this.sliderWidth - SLIDER_PADDING, this.lineY);

        // Draw the slider pommel.
        this.pommel.clear();
        this.pommel.lineStyle({
            color: this.lineColor,
            width: this.lineThickness,
        });
        this.pommel.beginFill(this.pommelColor, this.dragging ? 0.5 : 1.0);
        this.pommel.drawCircle(0, 0, this.pommelRadius);
        this.pommel.endFill();
    }

    public onValueChanged(handler: (value: number) => void): void {
        this.valueChangedHandler = handler;
    }

    public updateBounds(min: number, max: number, step?: number): void {
        this.min = min;
        this.minText.text = this.min.toString();
        this.max = max;
        this.maxText.text = this.max.toString();
        if (step !== undefined)
            this.step = step;
        this.value = min;

        this.draw();
    }

    public getSliderBounds(): { min: number, max: number, step: number } {
        return {
            min: this.min,
            max: this.max,
            step: this.step,
        };
    }

    public get value(): number {
        return this.val;
    }

    public set value(val: number) {
        this.val = val;

        // Position the pommel and label correctly to reflect the new value.
        this.pommel.position.x =
            this.minPommelX + ((val - this.min) * this.lineSegmentLength);
        this.valText.position.x = this.pommel.position.x;
        this.valText.text = val.toString();
    }

    public updateSliderWidth(width: number): void {
        this.sliderWidth = width;
        this.maxPommelX = this.sliderWidth -
            (SLIDER_PADDING + this.pommelRadius);
        const lineWidth = (this.sliderWidth - (2 * SLIDER_PADDING)) -
            (2 * this.pommelRadius);
        this.lineSegmentLength = lineWidth / (this.max - this.min);
        this.maxText.position.set(
            this.sliderWidth - (SLIDER_PADDING / 2), this.lineY
        );
        this.draw();
    }

}
