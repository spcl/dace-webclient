// This file uses CommonJS require instead of ES6 imports because it is not transpiled
const path = require('path');
const webpack = require('webpack');

module.exports = {
    entry: {
        sdfv: './src/sdfv.js',
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
        fallback: {
            stream: require.resolve("stream-browserify/"),
            util: require.resolve("util/"),
        },
    },
    plugins: [
        new webpack.ProvidePlugin({
            process: 'process/browser'
        }),
    ],
    devtool: 'source-map',
    devServer: {
        publicPath: '/dist/',
    },
    output: {
        filename: '[name].js',
        path: path.resolve(__dirname, 'dist'),
    },
};
