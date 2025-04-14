import {
    CFV_BasicBlock,
    CFV_Conditional,
    CFV_ControlFlowBlock,
    CFV_Loop,
    CFV_Sequence,
} from './renderer_elements';
import type { ControlFlowView } from './control_flow_view';


const CFV_SEQUENCE_MARGIN = 20;
const CFV_SEQUENCE_SPACING = 100;
const CFV_LINE_SPACING = 5;
const CFV_CONNECTOR_SIZE = 10;
const CFV_BASIC_BLOCK_HEIGHT = 100;
const CFV_BASIC_BLOCK_WIDTH = 100;

export function layoutConnectors(block: CFV_ControlFlowBlock): void {
    let inX = block.x + CFV_CONNECTOR_SIZE / 2;
    let outX = block.x + CFV_CONNECTOR_SIZE / 2;
    for (const conn of block.inConnectors) {
        conn.height = CFV_CONNECTOR_SIZE;
        conn.width = CFV_CONNECTOR_SIZE;
        conn.x = inX;
        conn.y = block.y - (conn.height / 2);
        inX += CFV_CONNECTOR_SIZE * 1.5;
    }
    for (const conn of block.outConnectors) {
        conn.height = CFV_CONNECTOR_SIZE;
        conn.width = CFV_CONNECTOR_SIZE;
        conn.x = outX;
        conn.y = (block.y + block.height) - (conn.height / 2);
        outX += CFV_CONNECTOR_SIZE * 1.5;
    }
}

export function layoutEdges(
    block: CFV_ControlFlowBlock,
    renderer: ControlFlowView,
): void {
    let nInEdges = 0;
    for (const conn of block.inConnectors)
        nInEdges += conn.edges.length;
    let nOutEdges = 0;
    for (const conn of block.outConnectors)
        nOutEdges += conn.edges.length;

    let inLaneX = nInEdges * CFV_LINE_SPACING;
    let outLaneX = renderer.cfSequence!.width;
    let inYOffset = 5;
    let outYOffset = 5 + nOutEdges * CFV_LINE_SPACING;
    for (const conn of block.inConnectors) {
        for (const edge of conn.edges) {
            let srcConn;
            for (const oConn of edge.src.outConnectors) {
                if (oConn.dataName == conn.dataName) {
                    srcConn = oConn;
                    break;
                }
            }
            if (!srcConn) {
                console.warn('Uh oh!');
                srcConn = edge.src;
            }
            const srcX = srcConn.x + (srcConn.width / 2);
            const dstX = conn.x + (conn.width / 2);
            edge.points = [
            {
                x: srcX,
                y: srcConn.y + srcConn.height,
            },
            {
                x: srcX,
                y: srcConn.y + srcConn.height + inYOffset,
            },
            {
                x: inLaneX,
                y: srcConn.y + srcConn.height + inYOffset,
            },
            {
                x: inLaneX,
                y: conn.y - inYOffset,
            },
            {
                x: dstX,
                y: conn.y - inYOffset,
            },
            {
                x: dstX,
                y: conn.y,
            }];
            edge.x = edge.points[0].x;
            edge.y = edge.points[0].y;
            let maxX = edge.points[0].x;
            let maxY = edge.points[0].x;
            for (let i = 1; i < edge.points.length; i++) {
                if (edge.points[i].x > maxX)
                    maxX = edge.points[i].x;
                if (edge.points[i].y > maxY)
                    maxY = edge.points[i].y;
                if (edge.points[i].x < edge.x)
                    edge.x = edge.points[i].x;
                if (edge.points[i].y < edge.y)
                    edge.y = edge.points[i].y;
            }
            edge.width = maxX - edge.x;
            edge.height = maxY - edge.y;
            inLaneX += CFV_LINE_SPACING;
            inYOffset += CFV_LINE_SPACING;
        }
    }
    for (const conn of block.outConnectors) {
        for (const edge of conn.edges) {
            let dstConn;
            for (const oConn of edge.dst.inConnectors) {
                if (oConn.dataName == conn.dataName) {
                    dstConn = oConn;
                    break;
                }
            }
            if (!dstConn) {
                console.warn('Uh oh!');
                dstConn = edge.dst;
            }
            const srcX = conn.x + (conn.width / 2);
            const dstX = dstConn.x + (dstConn.width / 2);
            edge.points = [{
                x: srcX,
                y: conn.y + conn.height,
            },
            {
                x: srcX,
                y: conn.y + conn.height + outYOffset,
            },
            {
                x: outLaneX,
                y: conn.y + conn.height + outYOffset,
            },
            {
                x: outLaneX,
                y: dstConn.y - outYOffset,
            },
            {
                x: dstX,
                y: dstConn.y - outYOffset,
            },
            {
                x: dstX,
                y: dstConn.y,
            }];
            edge.x = edge.points[0].x;
            edge.y = edge.points[0].y;
            let maxX = edge.points[0].x;
            let maxY = edge.points[0].x;
            for (let i = 1; i < edge.points.length; i++) {
                if (edge.points[i].x > maxX)
                    maxX = edge.points[i].x;
                if (edge.points[i].y > maxY)
                    maxY = edge.points[i].y;
                if (edge.points[i].x < edge.x)
                    edge.x = edge.points[i].x;
                if (edge.points[i].y < edge.y)
                    edge.y = edge.points[i].y;
            }
            edge.width = maxX - edge.x;
            edge.height = maxY - edge.y;
            outLaneX += CFV_LINE_SPACING;
            outYOffset -= CFV_LINE_SPACING;
        }
    }
}

export function layoutSequence(sequence: CFV_Sequence): void {
    let lastY = sequence.y + CFV_SEQUENCE_MARGIN;
    let lastX = sequence.x + CFV_SEQUENCE_MARGIN;
    if (!sequence.isCollapsed) {
        let maxWidth = 0;
        for (const block of sequence.children) {
            block.y = lastY;
            block.x = lastX;
            if (block instanceof CFV_BasicBlock) {
                block.height = CFV_BASIC_BLOCK_HEIGHT;
                block.width = CFV_BASIC_BLOCK_WIDTH;
            } else if (block instanceof CFV_Loop) {
                layoutSequence(block);
            } else if (block instanceof CFV_Conditional) {
                let maxHeight = 0;
                let totalWidth = 0;
                for (const branch of block.branches) {
                    branch[1].x = lastX + totalWidth;
                    branch[1].y = lastY;
                    layoutSequence(branch[1]);
                    layoutConnectors(branch[1]);
                    totalWidth += branch[1].width;
                    if (branch[1].height > maxHeight)
                        maxHeight = branch[1].height;
                }
                block.height = maxHeight;
                block.width = totalWidth;
            }
            layoutConnectors(block);
            lastY += CFV_SEQUENCE_SPACING + block.height;
            if (block.width > maxWidth)
                maxWidth = block.width;
        }
        sequence.height = lastY - sequence.y;
        sequence.width = maxWidth + 2 * CFV_SEQUENCE_MARGIN;
    } else {
        sequence.height = CFV_BASIC_BLOCK_HEIGHT;
        sequence.width = CFV_BASIC_BLOCK_WIDTH;
    }
}

export function layoutEdgesForSequence(
    sequence: CFV_Sequence,
    renderer: ControlFlowView
): void {
    if (!sequence.isCollapsed) {
        for (const block of sequence.children) {
            layoutEdges(block, renderer);
            if (block instanceof CFV_Sequence) {
                layoutEdgesForSequence(block, renderer);
            } else if (block instanceof CFV_Conditional) {
                for (const branch of block.branches) {
                    layoutEdges(branch[1], renderer);
                    layoutEdgesForSequence(branch[1], renderer);
                }
            }
        }
    }
}
