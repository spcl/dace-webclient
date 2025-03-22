import {
    CFV_BasicBlock,
    CFV_Conditional,
    CFV_ControlFlowBlock,
    CFV_Loop,
    CFV_Sequence,
} from './renderer_elements';
import type { ControlFlowView } from './control_flow_view';


const CFV_SEQUENCE_MARGIN = 10;
const CFV_SEQUENCE_SPACING = 50;
const CFV_BASIC_BLOCK_HEIGHT = 50;
const CFV_BASIC_BLOCK_WIDTH = 50;

export function layoutConnectors(block: CFV_ControlFlowBlock): void {
    let inX = block.x + 5;
    let outX = block.x + 5;
    for (const conn of block.inConnectors) {
        conn.x = inX;
        conn.y = block.y - (conn.height / 2);
        inX += 5;
    }
    for (const conn of block.outConnectors) {
        conn.x = outX;
        conn.y = (block.y + block.height) - (conn.height / 2);
        outX += 5;
    }
}

export function layoutEdges(
    block: CFV_ControlFlowBlock,
    renderer: ControlFlowView,
): void {
    let inLaneX = 0;
    let outLaneX = renderer.cfSequence!.width;
    const lineSpacer = 2;
    let inSrcY = 5;
    let inDstY = 5;
    let outSrcY = 5;
    let outDstY = 5;
    for (const conn of block.inConnectors) {
        for (const edge of conn.edges) {
            let srcConn;
            for (const oConn of edge.src.outConnectors) {
                if (oConn.dataName == conn.dataName) {
                    srcConn = oConn;
                    break;
                }
            }
            if (!srcConn)
                throw Error('Uh oh!');
            const srcX = srcConn.x + (srcConn.width / 2);
            const dstX = conn.x + (conn.width / 2);
            edge.points = [
            {
                x: srcX,
                y: srcConn.y + srcConn.height,
            },
            {
                x: srcX,
                y: srcConn.y + srcConn.height + inSrcY,
            },
            {
                x: inLaneX,
                y: srcConn.y + srcConn.height + inSrcY,
            },
            {
                x: inLaneX,
                y: conn.y - inDstY,
            },
            {
                x: dstX,
                y: conn.y - inDstY,
            },
            {
                x: dstX,
                y: conn.y,
            }];
            inLaneX -= lineSpacer;
            inSrcY += lineSpacer;
            inDstY += lineSpacer;
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
            if (!dstConn)
                throw Error('Uh oh!');
            const srcX = conn.x + (conn.width / 2);
            const dstX = dstConn.x + (dstConn.width / 2);
            edge.points = [{
                x: srcX,
                y: conn.y + conn.height,
            },
            {
                x: srcX,
                y: conn.y + conn.height + outSrcY,
            },
            {
                x: outLaneX,
                y: conn.y + conn.height + outSrcY,
            },
            {
                x: outLaneX,
                y: dstConn.y - outDstY,
            },
            {
                x: dstX,
                y: dstConn.y - outDstY,
            },
            {
                x: dstX,
                y: dstConn.y,
            }];
            outLaneX += lineSpacer;
            outSrcY += lineSpacer;
            outDstY += lineSpacer;
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
