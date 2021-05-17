const path = require('path');

module.exports = {
    mode: 'development',
    entry: {
        layoutLib: './src/layoutLib.js',
        renderLib: './src/renderLib.js',
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
        ],
    },
    resolve: {
        extensions: ['.ts', '.js'],
    },
    output: {
        library: '[name]',
        libraryTarget: 'assign-properties',
        filename: '[name].js',
        path: path.resolve(__dirname, 'dist'),
    },
};