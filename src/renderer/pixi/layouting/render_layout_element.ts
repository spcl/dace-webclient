import { LayoutElement } from './layout';
import * as PIXI from 'pixi.js';
import { overlayColors, stringToColor } from '../../../utils/colors';
import { getTemperatureRGBHex } from '../../../utils/colors';

/**
 * Display state for an object
 */
export type LayoutElementDisplayState = 'normal' | 'hover' | 'highlighted';

/**
 * The larger this constant, the larger the non-acute angle(s) of rendered polygons (1 = 135°)
 */
const POLYGON_DENT_SIZE = 1;

/**
 * The value added to the z index (order) of the rendered elements. All values should be in (0, 1)
 */
const Z_INCREMENTS = {
    type: {
        state: 0.1,
        edgeShade: 0.15,
        node: 0.2,
        connector: 0.3,
        edge: 0.4,
    },

    label: 0.0001,
    selected: 0.001,
    displayState: {
        normal: 0,
        highlighted: 0.002,
        hover: 0.004,
    },
} as const;

const ARROW_LENGTH = 15;
const ARROW_WIDTH = 10;
const COLLAPSED_STATE_PLUS_SIZE = 32;

const getTextStyle = (scale = 1): Partial<PIXI.ITextStyle> => ({
    fontSize: 14 * scale,
    fontFamily: ['ui-monospace', 'monospace']
});

export function getTextMetrics(text: string): PIXI.TextMetrics {
    if (typeof text !== 'string') {
        console.error('Parameter not a string!', text);
        throw new Error('Parameter not a string! ' + typeof text);
    }
    return PIXI.TextMetrics.measureText(text, new PIXI.TextStyle(getTextStyle()));
}

export type RenderedLayoutElement = {
    layoutElement: LayoutElement,
    always: PIXI.DisplayObject[],
    far: PIXI.DisplayObject[],
    near: PIXI.DisplayObject[],
    hitbox: PIXI.Rectangle,
};

export function getAllDisplayObjects(rendered: RenderedLayoutElement): PIXI.DisplayObject[] {
    return [...rendered.always, ...rendered.far, ...rendered.near];
}

export function renderLayoutElement(
    el: LayoutElement,
    style: CSSStyleDeclaration,
    settings: {
        displayState: LayoutElementDisplayState,
        isSelected: boolean,
        detailMode: 'detailed' | 'normal' | 'quick',
    }
): RenderedLayoutElement {
    const createReturn = (arr: PIXI.DisplayObject[]) => ({
        layoutElement: el,
        always: arr,
        far: [],
        near: [],
        hitbox: arr.map(obj => {
            const bounds = obj.getLocalBounds();
            bounds.x += obj.x;
            bounds.y += obj.y;
            return bounds;
        }).reduce((a, b) => a.enlarge(b)),
    });

    const col = (s: string, alt: string) => stringToColor(style.getPropertyValue(s) || alt);
    const textStyle = (s: string, alt: string, scale = 1) => ({ ...getTextStyle(scale), fill: col(s, alt)[0] });


    const quickMode = {
        detailed: false,
        normal: false,
        quick: true,
    }[settings.detailMode];

    const textResolution = {
        detailed: 10,
        normal: 2,
        quick: 0.2,
    }[settings.detailMode];

    const zIncr = Z_INCREMENTS.displayState[settings.displayState]
        + (settings.isSelected ? Z_INCREMENTS.selected : 0);

    const specialDisplayColor = (!settings.isSelected ? {
        normal: null,
        hover: col('--color-hovered', 'green'),
        highlighted: col('--color-highlighted', 'orange'),
    } : {
        normal: col('--color-selected', 'red'),
        hover: col('--color-selected-hovered', 'salmon'),
        highlighted: col('--color-selected-highlighted', 'darkorange'),
    })[settings.displayState];


    switch (el.type) {
        case 'state': {
            const gfx = new PIXI.Graphics();
            gfx.zIndex = el.zIndex + Z_INCREMENTS.type.state + zIncr;
            gfx.x = el.x;
            gfx.y = el.y;
            gfx.beginFill(...col('--state-background-color', '#ccf0ff'));
            if (specialDisplayColor) gfx.lineStyle(1, ...specialDisplayColor);
            gfx.drawRect(0, 0, el.width, el.height);

            if (el.isCollapsed) {
                gfx.lineStyle(2, ...col('--state-foreground-color', 'black'));
                gfx.moveTo(el.width / 2, el.height / 2 - COLLAPSED_STATE_PLUS_SIZE / 2);
                gfx.lineTo(el.width / 2, el.height / 2 + COLLAPSED_STATE_PLUS_SIZE / 2);
                gfx.moveTo(el.width / 2 - COLLAPSED_STATE_PLUS_SIZE / 2, el.height / 2);
                gfx.lineTo(el.width / 2 + COLLAPSED_STATE_PLUS_SIZE / 2, el.height / 2);
            }

            const text = new PIXI.Text(el.caption, textStyle('--state-foreground-color', 'black'));
            text.resolution *= textResolution;
            text.x = 2;
            text.y = 2;
            gfx.addChild(text);

            return createReturn([gfx]);
        }
        case 'node': {
            const gfx = new PIXI.Graphics();
            gfx.zIndex = el.zIndex + Z_INCREMENTS.type.node;
            gfx.x = el.x;
            gfx.y = el.y;

            let bgColor = col('--node-background-color', 'white');
            if (el.backgroundTemperature !== undefined) {
                bgColor = overlayColors(bgColor, [getTemperatureRGBHex(el.backgroundTemperature), 0.6]);
            }

            const strokeSize = {
                normal: 1,
                double: 1.5,
                bold: 2.5,
            }[el.stroke];
            const toDraw = [
                [0, 0, el.width, el.height, strokeSize] as const,
                ...el.stroke !== 'double' ? []
                    : [[2.5, 2.5, el.width - 5, el.height - 5, 1]] as const,
            ];

            for (const [x, y, w, h, stroke] of toDraw) {
                const drawTranslatedPolygon = (...points: number[]) => {
                    gfx.drawPolygon(
                        points.map((p, i) => p + (i % 2 === 0 ? x : y)),
                    );
                };

                gfx.beginFill(...bgColor);
                gfx.lineStyle(stroke, ...specialDisplayColor ?? col('--node-foreground-color', 'black'));
                switch (el.shape) {
                    case 'ellipse': {
                        const hw = w / 2;
                        const hh = h / 2;
                        gfx.drawEllipse(x + hw, y + hh, hw, hh);
                        break;
                    }
                    case 'octagon': {
                        const dent = Math.min(w / 2, POLYGON_DENT_SIZE * h / 2);
                        drawTranslatedPolygon(
                            dent, 0,
                            0, h / 3,
                            0, 2 * h / 3,
                            dent, h,
                            w - dent, h,
                            w, 2 * h / 3,
                            w, h / 3,
                            w - dent, 0,
                        );
                        break;
                    }
                    case 'hexagon': {
                        const dent = Math.min(w / 2, POLYGON_DENT_SIZE * h);
                        drawTranslatedPolygon(
                            dent, 0,
                            0, h / 2,
                            dent, h,
                            w - dent, h,
                            w, h / 2,
                            w - dent, 0,
                        );
                        break;
                    }
                    case 'upperHexagon': {
                        const dent = Math.min(w / 2, POLYGON_DENT_SIZE * h);
                        drawTranslatedPolygon(
                            dent, 0,
                            w - dent, 0,
                            w, h,
                            0, h,
                        );
                        break;
                    }
                    case 'lowerHexagon': {
                        const dent = Math.min(w / 2, POLYGON_DENT_SIZE * h);
                        drawTranslatedPolygon(
                            0, 0,
                            w, 0,
                            w - dent, h,
                            dent, h,
                        );
                        break;
                    }
                    case 'triangle': {
                        drawTranslatedPolygon(
                            0, 0,
                            w, 0,
                            w / 2, h,
                        );
                        break;
                    }
                    case 'rectangle': {
                        gfx.drawRect(
                            x, y,
                            w, h,
                        );
                        break;
                    }
                    default: {
                        throw new Error(`Unknown shape ${el.shape}!`);
                    }
                }
            }

            const createText = ((distance: 'always' | 'near' | 'far') => {
                if ((el.farCaption === undefined) !== (distance === 'always')) return [];

                const textPosition = el.shape === 'triangle' ? 0.25 : 0.5;
                const caption = distance === 'far' ? el.farCaption! : el.caption;
                const fontSizeScale = distance === 'far' ? 1.8 : 1;

                const text = new PIXI.Text(caption, textStyle('--node-foreground-color', 'black', fontSizeScale));
                text.resolution *= textResolution;
                text.zIndex = gfx.zIndex + Z_INCREMENTS.label;
                text.x = el.x + el.width / 2 - text.width / 2;
                text.y = el.y + el.height * textPosition - text.height / 2;
                return [text];
            });

            const bounds = gfx.getLocalBounds();
            bounds.x += gfx.x;
            bounds.y += gfx.y;

            return {
                layoutElement: el,
                always: [gfx, ...createText('always')],
                near: createText('near'),
                far: createText('far'),
                hitbox: bounds,
            };
        }
        case 'connector': {
            const color = el.scopedColor ? col('--connector-scoped-color', 'white')
                : col('--connector-unscoped-color', '#c1dfe690');

            const gfx = new PIXI.Graphics();
            gfx.zIndex = el.zIndex + Z_INCREMENTS.type.connector;
            gfx.x = el.x;
            gfx.y = el.y;
            gfx.beginFill(...color);
            gfx.lineStyle(1, ...specialDisplayColor ?? col('--node-foreground-color', 'black'));
            gfx.drawCircle(0, 0, el.radius);
            return createReturn([gfx]);
        }
        case 'edge': {
            const ps = el.points;

            const edgeColor = el.interstateColor ? col('--interstate-edge-color', '#86add9')
                : col('--color-default', 'black');

            // Define colors used to draw the arrow
            const styles: [
                extraWidth: number,
                color: [rgbHex: number, alpha: number],
                zIncr: number
            ][] = [[
                0,
                specialDisplayColor ?? edgeColor,
                Z_INCREMENTS.type.edge
            ]];
            if (el.shadeTemperature !== undefined) {
                styles.push([
                    6,
                    [getTemperatureRGBHex(el.shadeTemperature), 0.6],
                    Z_INCREMENTS.type.edgeShade
                ]);
            }

            // Compute tangent at the end point
            const lp = ps[ps.length - 1];
            const slp = ps[ps.length - 2];
            const tangent = [
                lp[0] - slp[0],
                lp[1] - slp[1],
            ];

            // Normalize tangent
            const tl = Math.sqrt(tangent[0] ** 2 + tangent[1] ** 2);
            tangent[0] /= tl;
            tangent[1] /= tl;

            // Normal is orthogonal to tangent
            const normal = [
                -tangent[1],
                tangent[0],
            ];

            // Draw the arrow (and its shade)
            const gfxs = styles.map(([extraWidth, color, zIncr]) => {
                const gfx = new PIXI.Graphics();
                gfx.zIndex = el.zIndex + zIncr;

                const lineStyle = {
                    color: color[0],
                    alpha: color[1],
                    cap: !quickMode && extraWidth > 0 ? PIXI.LINE_CAP.ROUND : PIXI.LINE_CAP.BUTT,
                    join: !quickMode && extraWidth > 0 ? PIXI.LINE_JOIN.ROUND : PIXI.LINE_JOIN.MITER,
                };

                // Draw line
                gfx.lineStyle({
                    width: 1 + extraWidth,
                    ...lineStyle,
                });
                if (ps.length < 2) {
                    throw new Error('Need at least two points to draw an arrow!');
                }
                gfx.moveTo(...ps[0]);
                switch (ps.length) {
                    case 2: {
                        gfx.lineTo(...ps[1]);
                        break;
                    }
                    case 3: {
                        gfx.quadraticCurveTo(...ps[1], ...ps[2]);
                        break;
                    }
                    case 4: {
                        gfx.bezierCurveTo(...ps[1], ...ps[2], ...ps[3]);
                        break;
                    }
                    default: {
                        let i;
                        for (i = 1; i < ps.length - 2; i++) {
                            const xm = (ps[i][0] + ps[i + 1][0]) / 2.0;
                            const ym = (ps[i][1] + ps[i + 1][1]) / 2.0;
                            gfx.quadraticCurveTo(...ps[i], xm, ym);
                        }
                        gfx.quadraticCurveTo(...ps[i], ...ps[i + 1]);
                        break;
                    }
                }

                // Draw triangle
                const aw = ARROW_WIDTH;
                const al = ARROW_LENGTH;
                gfx.lineStyle({
                    width: extraWidth,
                    ...lineStyle,
                });
                gfx.beginFill(color[0]);
                gfx.drawPolygon(
                    ...lp,
                    lp[0] - al * tangent[0] + aw / 2 * normal[0], lp[1] - al * tangent[1] + aw / 2 * normal[1],
                    lp[0] - al * tangent[0] - aw / 2 * normal[0], lp[1] - al * tangent[1] - aw / 2 * normal[1],
                );
                gfx.endFill();

                // Collision detection
                const collisionDistance = ARROW_WIDTH;
                let curvePoints: number[][] = [];
                let curveLines: [[number, number], [number, number]][] = [];
                let collisionBoundingBox = new PIXI.Rectangle(0, 0, 0, 0);
                gfx.hitArea = {
                    contains: (x, y) => {
                        // before the first render, curvePoints is empty, so recompute it if that's the case
                        if (curvePoints.flat().length === 0) {
                            curvePoints = gfx.geometry.graphicsData.map(data => data.points);
                            curveLines = curvePoints.flatMap(linePoints => {
                                const res: [[number, number], [number, number]][] = [];
                                for (let i = 0; i < linePoints.length - 3; i += 2) {
                                    res.push([[linePoints[i], linePoints[i + 1]], [linePoints[i + 2], linePoints[i + 3]]]);
                                }
                                return res;
                            });
                            if (curvePoints.length > 0) {
                                const allX = curvePoints.flat().filter((_, i) => i % 2 === 0);
                                const allY = curvePoints.flat().filter((_, i) => i % 2 === 1);
                                const minX = Math.min(...allX) - collisionDistance;
                                const minY = Math.min(...allY) - collisionDistance;
                                const maxX = Math.max(...allX) + collisionDistance;
                                const maxY = Math.max(...allY) + collisionDistance;
                                collisionBoundingBox = new PIXI.Rectangle(minX, minY, maxX - minX, maxY - minY);
                            }
                        }

                        if (!collisionBoundingBox.contains(x, y)) {
                            return false;
                        }

                        return curveLines.some(([p1, p2]) => {
                            const sq = (x: number) => x * x;
                            const distSq = (a: [number, number], b: [number, number]) => sq(a[0] - b[0]) + sq(a[1] - b[1]);

                            const lineLength = distSq(p1, p2);
                            const t = ((x - p1[0]) * (p2[0] - p1[0]) + (y - p1[1]) * (p2[1] - p1[1])) / lineLength;
                            const tClamped = Math.max(0, Math.min(1, t));
                            const distToLineSq = distSq([x, y], [p1[0] + tClamped * (p2[0] - p1[0]), p1[1] + tClamped * (p2[1] - p1[1])]);

                            return distToLineSq <= sq(collisionDistance / 2);
                        });
                    },
                };

                return gfx;
            });

            return createReturn(gfxs);
        }
    }
}
