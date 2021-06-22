// This file uses CommonJS require instead of ES6 imports because it is not transpiled
const path = require('path');

module.exports = {
    entry: {
        sdfv: './src/sdfv.js',
        main: './src/main.js',
    },
    module: {
        rules: [
            {
                test: /\.m?[jt]sx?$/,
                use: 'babel-loader',
                exclude: /node_modules/,
            },
        ],
    },
    resolve: {
        extensions: ['.ts', '.js'],
    },
    devtool: 'source-map',
    devServer: {
        publicPath: '/dist/',
    },
    output: {
        filename: '[name].js',
        path: path.resolve(__dirname, 'dist'),
    },
};
