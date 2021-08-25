// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

import * as PIXI from 'pixi.js';
// @ts-ignore canvas2pdf has no type definitions
import canvas2pdf from 'canvas2pdf';
import blobStream from 'blob-stream';
import { colorToString } from './colors';

export async function pixiObjectToPdf(displayObject: PIXI.DisplayObject, size: readonly [number, number] | null): Promise<Blob> {
    return await new Promise(resolve => {
        const ctx = new canvas2pdf.PdfContext(blobStream(), {
            size: size ?? [displayObject.getLocalBounds().width, displayObject.getLocalBounds().height],
        });

        drawPixiObject(displayObject, ctx);

        ctx.stream.on('finish', () => {
            const blob = ctx.stream.toBlob('application/pdf');
            resolve(blob);
        });
        ctx.end();
    });
}

function drawPixiObject(obj: PIXI.DisplayObject, ctx: CanvasRenderingContext2D) {
    if (!obj.visible) return;

    ctx.save();

    ctx.translate(obj.x, obj.y);
    ctx.scale(obj.scale.x, obj.scale.y);


    switch (Object.getPrototypeOf(obj)) {
        case PIXI.Container.prototype: {
            // nothing to do here!
            break;
        }
        case PIXI.Graphics.prototype: {
            const gfx = obj as PIXI.Graphics;
            for (const gfxData of gfx.geometry.graphicsData) {
                ctx.save();

                ctx.fillStyle = colorToString(gfxData.fillStyle.color, gfxData.fillStyle.alpha);
                ctx.strokeStyle = colorToString(gfxData.lineStyle.color, gfxData.lineStyle.alpha);
                ctx.lineWidth = gfxData.lineStyle.width;
                ctx.lineCap = gfxData.lineStyle.cap;
                ctx.lineJoin = gfxData.lineStyle.join;

                for (const action of ['fill', 'stroke'] as const) {
                    if (action === 'fill' && !gfxData.fillStyle.visible) continue;
                    if (action === 'stroke' && !gfxData.lineStyle.visible) continue;

                    switch (gfxData.shape.type) {
                        case PIXI.SHAPES.RECT: {
                            ctx[`${action}Rect` as const](
                                gfxData.shape.x,
                                gfxData.shape.y,
                                gfxData.shape.width,
                                gfxData.shape.height,
                            );
                            break;
                        }
                        case PIXI.SHAPES.POLY: {
                            ctx.beginPath();
                            ctx.moveTo(gfxData.shape.points[0], gfxData.shape.points[1]);
                            for (let i = 2; i < gfxData.shape.points.length; i += 2) {
                                ctx.lineTo(gfxData.shape.points[i], gfxData.shape.points[i + 1]);
                            }
                            if (gfxData.shape.closeStroke) ctx.closePath();
                            ctx[action]();
                            break;
                        }
                        case PIXI.SHAPES.CIRC: {
                            ctx.beginPath();
                            ctx.arc(gfxData.shape.x, gfxData.shape.y, gfxData.shape.radius, 0, 2 * Math.PI);
                            ctx[action]();
                            break;
                        }
                        case PIXI.SHAPES.ELIP: {
                            const x = gfxData.shape.x;
                            const y = gfxData.shape.y;
                            const rx = gfxData.shape.width;
                            const ry = gfxData.shape.height;

                            ctx.beginPath();

                            // The PDF library doesn't have ellipse support, so be smart about it
                            ctx.save();
                            ctx.translate(x - rx, y - ry);
                            ctx.scale(rx, ry);
                            ctx.arc(1, 1, 1, 0, 2 * Math.PI);
                            ctx.restore();

                            ctx[action]();
                            break;
                        }
                        default: {
                            console.error('Unsupported graphics data shape type!', gfxData, gfx);
                            throw new Error(`Unsupported graphics data shape type! ${gfxData.shape.type}`);
                        }
                    }
                }

                ctx.restore();
            }

            break;
        }
        case PIXI.Text.prototype: {
            const text = obj as PIXI.Text;

            let fontSize = text.style.fontSize ?? 26;
            if (typeof fontSize === 'number') fontSize = fontSize + 'px';

            const fillStyle = text.style.fill ?? 'black';
            if (typeof fillStyle === 'number' || Array.isArray(fillStyle)) throw new Error('Unsupported fillStyle value!');

            // PDF font availability is very limited, so we always use Courier and re-center the text
            ctx.font = `${fontSize} Courier`;
            const extraX = (ctx.measureText(text.text).width - text.width) / 2;
            ctx.fillStyle = fillStyle;
            // set baseline to top as a work-around to roughly get Pixi's text alignment
            ctx.textBaseline = 'top';
            ctx.fillText(text.text, extraX, 0);

            break;
        }
        default: {
            console.error('Unsupported Pixi object type for PDF conversion!', obj);
            throw new Error(`Unsupported Pixi object type for PDF conversion! ${obj.constructor.name}`);
        }
    }

    if (obj instanceof PIXI.Container) {
        [...obj.children].sort((a, b) => a.zIndex - b.zIndex).forEach(child => {
            drawPixiObject(child, ctx);
        });
    }

    ctx.restore();
}
