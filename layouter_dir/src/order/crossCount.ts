import {GPU} from "gpu.js";
import * as _ from "lodash";

export class CrossCount {
    static pipeline = null;

    static buildGraph(n: number, density: number = 0.1) {
        const edges = [];
        for (let i = 0; i < n; ++i) {
            for (let j = 0; j < n; ++j) {
                if (Math.random() < density) {
                    edges.push([i, j]);
                }
            }
        }
        return edges;
    }

    static countEfficient(numNorth: number, numSouth: number, edges: Array<[number, number]>): number {
        // build south sequence
        const southSequence = _.map(_.sortBy(edges, edge => edge[0] * numSouth + edge[1]), edge => edge[1]);

        // build the accumulator tree
        let firstIndex = 1;
        while (firstIndex < numSouth) {
            firstIndex *= 2; // number of tree nodes
        }
        const treeSize = 2 * firstIndex - 1;
        firstIndex -= 1; // index of leftmost leaf
        const tree = _.fill(new Array(treeSize), 0);

        // count the crossings
        let count = 0;
        _.forEach(southSequence, (i: number) => {
            let index = i + firstIndex;
            tree[index]++;
            while (index > 0) {
                if (index % 2) {
                    count += tree[index + 1];
                }
                index = Math.floor((index - 1) / 2);
                tree[index]++;
            }
        });
        return count;
    }

    static initGpu(): void {
        const gpu = new GPU();

        CrossCount.pipeline = [

            // left shift
            gpu.createKernel(function (adjacencyMatrix) {
                return ((this.thread.x === this.output.x - 1) ? 0 : adjacencyMatrix[this.thread.y][this.thread.x + 1]);
            }, {
                dynamicArguments: true,
                dynamicOutput: true,
                pipeline: true,
            }),

            // take row-wise cumulative sum
            gpu.createKernel(function (leftShifted, i: number) {
                const numCols = this.output.x;
                let sum = leftShifted[this.thread.y][this.thread.x];
                if (this.thread.x + i < numCols) {
                    sum += leftShifted[this.thread.y][this.thread.x + i];
                }
                return sum;
            }, {
                dynamicArguments: true,
                dynamicOutput: true,
                pipeline: true,
                immutable: true,
            }),

            // down shift
            gpu.createKernel(function (rowSum) {
                return ((this.thread.y === 0) ? 0 : rowSum[this.thread.y - 1][this.thread.x]);
            }, {
                dynamicArguments: true,
                dynamicOutput: true,
                pipeline: true,
            }),

            // take column-wise cumulative sum
            gpu.createKernel(function (downShifted, i: number) {
                let sum = downShifted[this.thread.y][this.thread.x];
                if (this.thread.y - i >= 0) {
                    sum += downShifted[this.thread.y - i][this.thread.x];
                }
                return sum;
            }, {
                dynamicArguments: true,
                dynamicOutput: true,
                pipeline: true,
                immutable: true,
            }),

            // hadamard product (adjacency matrix acts as a mask)
            gpu.createKernel(function (columnSums, adjacencyMatrix) {
                return columnSums[this.thread.y][this.thread.x] * adjacencyMatrix[this.thread.y][this.thread.x];
            }, {
                dynamicArguments: true,
                dynamicOutput: true,
                pipeline: true,
            }),

            // row-wise sum
            gpu.createKernel(function (matrix, numCols) {
                let sum = 0;
                for (let j = 0; j < numCols; ++j) {
                    sum += matrix[this.thread.x][j];
                }
                return sum;
            }, {
                dynamicArguments: true,
                dynamicOutput: true
            }),
        ];
    }

    static countGpu(numNorth: number, numSouth: number, edges: Array<[number, number]>): number {
        if (CrossCount.pipeline === null) {
            throw new Error("Must call initGpu() before calling countGpu().");
        }

        const adjacencyMatrixSize = [numSouth, numNorth];
        //const height = Math.log2(Math.max(numNorth, numSouth) - 1) + 1;
        CrossCount.pipeline[0].setOutput(adjacencyMatrixSize);
        CrossCount.pipeline[1].setOutput(adjacencyMatrixSize);
        CrossCount.pipeline[2].setOutput(adjacencyMatrixSize);
        CrossCount.pipeline[3].setOutput(adjacencyMatrixSize);
        CrossCount.pipeline[4].setOutput(adjacencyMatrixSize);
        CrossCount.pipeline[5].setOutput([numNorth]);

        // build matrix
        const adjacencyMatrix = [];
        for (let i = 0; i < numNorth; ++i) {
            adjacencyMatrix.push(new Uint8Array(numSouth));
        }
        _.forEach(edges, edge => {
            adjacencyMatrix[edge[0]][edge[1]] = 1;
        });

        // execute pipeline
        let leftShifted = CrossCount.pipeline[0](adjacencyMatrix);
        for (let i = 1; i < numSouth; i <<= 1) {
            leftShifted = CrossCount.pipeline[1](leftShifted, i);
        }
        let downShifted = CrossCount.pipeline[2](leftShifted);
        leftShifted.delete();
        for (let i = 1; i < numNorth; i <<= 1) {
            downShifted = CrossCount.pipeline[3](downShifted, i);
        }
        const product = CrossCount.pipeline[4](downShifted, adjacencyMatrix);
        downShifted.delete();
        const sums = CrossCount.pipeline[5](product, numSouth);
        return _.sum(sums);
    }
}
